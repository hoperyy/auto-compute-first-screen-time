// 降级算法，该算法消耗一部分的性能，用于不支持 performance API 的场景，依赖 window.performance.timing

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

var win = window;
var doc = win.document;
var util = require('./util');

function generateApi(recordType) {
    var _global = util.mergeGlobal(util.initGlobal(), {
        intervalDotTimer: null,

        // dom 变化监听器
        mutationObserver: null,

        // 是否已经停止监听的标志
        hasStoppedObserve: false,

        // 记录 Mutation 回调时的 dom 信息
        dotList: [],

        recordType: recordType,

        // 记录图片加载完成的时刻（唯一）
        imgMap: {},

        // 用于记录两次 _global.mutationObserver 回调触发的时间间隔
        lastDomUpdateTime: scriptStartTime,

        options: {
            // 打点间隔
            dotDelay: 250,

            abortTimeWhenDelay: 2000 // 监控打点会引起页面重绘，如果引发页面重绘的时间超过了该值，则不再做性能统计
        }
    });

    function _getTargetDotObj() {
        // 倒序
        _global.dotList.sort(function (a, b) {
            if (a.timeStamp < b.timeStamp) {
                return 1;
            } else {
                return -1;
            }
        });

        var dotList = _global.dotList.slice(1);

        // 获取当前时刻的 dom 信息，作为基准值
        var finalImages = _global.dotList[0].firstScreenImages;

        var targetInfo;

        var isBiggerArray = function (bigArr, smallArr) {
            for (var i = 0, len = smallArr.length; i < len; i++) {
                if (bigArr.indexOf(smallArr[i]) === -1) {
                    return false;
                }
            }
            return true;
        };

        // 如果最终状态的首屏有图片，则通过比较首屏图片数量来确定是否首屏加载完毕
        if (finalImages.length > 0) {
            for (var i = 0, len = dotList.length; i < len; i++) {
                var item = dotList[i];
                if (isBiggerArray(item.firstScreenImages, finalImages)) {
                    targetInfo = dotList[i];
                }
            }
        } else {
            // 如果最终状态没有图片，则取出当前打点的对象，首屏时间设置为 performance 值
            targetInfo = _global.dotList[0];
            targetInfo.firstScreenTimeStamp = performance.timing.domComplete; // 有 bug，过早获取时该值可能为 0
            targetInfo.firstScreenTime = performance.timing.domComplete - util.NAV_START_TIME;
        }

        if (targetInfo) {
            targetInfo.isTargetDot = true;
        }

        return targetInfo;
    }

    function _getLastImgDownloadTime(images) {
        var timeArr = [];

        images.forEach(function (src) {
            timeArr.push(_global.imgMap[src].onloadTimeStamp);
        });

        // 倒序
        timeArr.sort(function (a, b) {
            if (a < b) {
                return 1;
            } else {
                return -1;
            }
        });

        return timeArr[0];
    }

    function _runOnTargetDotFound(targetObj) {
        if (_global.hasReported) {
            return;
        }

        _global.hasReported = true;

        // 为 _global.imgMap 添加是否是首屏标志
        var targetFirstScreenImages = null;
        var firstScreenImages = [];
        var i;
        var len;
        var requests = [];

        for (i = 0, len = _global.dotList.length; i < len; i++) {
            if (_global.dotList[i].isTargetDot) {
                targetFirstScreenImages = _global.dotList[i].firstScreenImages;
                break;
            }
        }

        if (targetFirstScreenImages) {
            for (i = 0, len = targetFirstScreenImages.length; i < len; i++) {
                firstScreenImages.push(targetFirstScreenImages[i].replace(/^http(s)?:/, '').replace(/^\/\//, ''));
            }
        }

        // 计算性能监控计算的耗时
        var delayFirstScreen = 0;
        for (i = 0, len = _global.dotList.length; i < len; i++) {
            if (_global.dotList[i].duration) {
                if (_global.dotList[i].timeStamp <= targetObj.timeStamp) {
                    delayFirstScreen += _global.dotList[i].duration;
                }
            }
        }

        // 规范化 requests
        for (var requestKey in _global.requestDetails) {
            var parsedRequestKey = requestKey
                .split('>time')[0]
                .replace(/^http(s)?:/, '')
                .replace(/^\/\//, '');
            requests.push(parsedRequestKey);
        }

        // 最终呈现给用户的首屏信息对象
        var resultObj = {
            maxErrorTime: targetObj.blankTime, // 最大误差值
            dotList: _global.dotList,

            isStaticPage: _global.isFirstRequestSent ? false : (_global.recordType === 'auto' ? true : 'unknown'),
            delayAll: _global.delayAll,
            requests: util.transRequestDetails2Arr(_global),
            firstScreenTime: targetObj.firstScreenTimeStamp - util.NAV_START_TIME,
            firstScreenTimeStamp: targetObj.firstScreenTimeStamp,
            firstScreenImages: targetObj.firstScreenImages,
            firstScreenImagesLength: targetObj.firstScreenImages.length,
            delayFirstScreen: delayFirstScreen,
            type: 'dot',
            version: util.version,
            runtime: util.getTime() - scriptStartTime,
            // 添加额外字段用于调试
            reportDetail: 'dot-target'
        };
        _runOnTimeFound(resultObj);
    }

    // 记录运行该方法时刻的 dom 信息，主要是 images；运行时机为每次 _global.mutationObserver 回调触发或定时器触发
    function recordDomInfo(param) {
        var recordFirstScreen = param && param.recordFirstScreen;

        // 如果性能监控打点引发的渲染 delay 超过了 0.5s，则停止性能监控打点
        if (!recordFirstScreen && _global.delayAll >= _global.options.abortTimeWhenDelay) {
            return;
        }

        var recordStartTime = util.getTime();

        var firstScreenImages = _getImages({ searchInFirstScreen: recordFirstScreen });

        var recordEndTime = util.getTime();

        _global.delayAll += recordEndTime - recordStartTime;

        var dotObj = {
            isImgInFirstScreen: recordFirstScreen,
            isFromInternal: (param && param.isFromInternal) ? true : false,
            isTargetDot: (param && param.isTargetDot) || false, // 默认是 false, 除非手动设置是目标打点（用于手动埋点）

            firstScreenImages: firstScreenImages,
            firstScreenImagesLength: firstScreenImages.length,
            blankTime: util.getTime() - _global.lastDomUpdateTime || util.getTime(), // 距离上次记录有多久（用于调试）
            firstScreenTimeStamp: -1, // 当前时刻下，所有图片加载完毕的时刻
            timeStamp: recordStartTime, // 当前时刻
            duration: recordEndTime - recordStartTime,
        };

        _global.dotList.push(dotObj);

        _global.lastDomUpdateTime = recordEndTime;

        // 如果没有图片，则以 domComplete 的时间为准（有可能值为 0）
        if (!firstScreenImages.length) {
            dotObj.firstScreenTimeStamp = performance.timing.domComplete;
            _checkTargetDot(dotObj);
        } else {
            var imgIndex = 0;
            var afterDownload = function (src) {
                imgIndex++;

                if (imgIndex === firstScreenImages.length) {
                    // 获取所有图片中加载时间最迟的时刻，作为 firstScreenTimeStamp
                    dotObj.firstScreenTimeStamp = _getLastImgDownloadTime(firstScreenImages);

                    // 检查是否是目标打点
                    _checkTargetDot(dotObj);
                }
            };

            var generateGlobalImgMapResult = function () {
                var time = util.getTime();
                return {
                    onloadTimeStamp: time,
                    onloadTime: time - util.NAV_START_TIME,
                }
            };

            firstScreenImages.forEach(function (src) {
                if (_global.imgMap[src]) {
                    afterDownload(src);
                } else {
                    var img = new Image();
                    img.src = src;

                    if (img.complete) {
                        // 记录该图片加载完成的时间，以最早那次为准
                        if (!_global.imgMap[src]) {
                            _global.imgMap[src] = generateGlobalImgMapResult();
                        }
                        afterDownload(src);
                    } else {
                        img.onload = img.onerror = function () {
                            // 记录该图片加载完成的时间，以最早那次为准
                            if (!_global.imgMap[src]) {
                                _global.imgMap[src] = generateGlobalImgMapResult();
                            }
                            afterDownload(src);
                        };
                    }
                }
            });
        }
    }

    function _getImages(param) {
        var screenHeight = win.innerHeight;
        var screenWidth = win.innerWidth;

        if (!_global.device.screenWidth) {
            _global.device.screenWidth = screenWidth;
        }
        if (!_global.device.screenHeight) {
            _global.device.screenHeight = screenHeight;
        }

        var searchInFirstScreen = param && param.searchInFirstScreen;

        var nodeIterator = util.queryAllNode();
        var currentNode = nodeIterator.nextNode();
        var imgList = [];

        var onImgSrcFound = function(imgSrc) {
            var protocol = util.parseUrl(imgSrc).protocol;
            if (protocol && protocol.indexOf('http') === 0) {
                // 去重
                if (imgList.indexOf(imgSrc) === -1) {
                    imgList.push(imgSrc);
                }
            }
        }

        // 遍历所有 dom
        while (currentNode) {
            var imgSrc = util.getImgSrcFromDom(currentNode, _global.options.img);

            // 如果没有 imgSrc，则直接读取下一个 dom 的信息
            if (!imgSrc) {
                currentNode = nodeIterator.nextNode();
                continue;
            }

            util.recordCurrentPos(currentNode);

            if (searchInFirstScreen) {
                if (util.isInFirstScreen(currentNode)) {
                    onImgSrcFound(imgSrc);
                } else {
                    var currentPos = util.currentPos;
                    // 用于统计
                    _global.ignoredImages.push({
                        src: imgSrc,
                        screenHeight: screenHeight,
                        screenWidth: screenWidth,
                        scrollTop: currentPos.scrollTop,
                        top: currentPos.top,
                        bottom: currentPos.bottom,
                        vertical: (currentPos.scrollTop + currentPos.top) <= screenHeight,
                        left: currentPos.left,
                        right: currentPos.right,
                        horizontal: currentPos.right >= 0 && currentPos.left <= screenWidth
                    });
                }
            } else {
                onImgSrcFound(imgSrc);
            }
            
            currentNode = nodeIterator.nextNode();
        }

        return imgList;
    }

    function _runOnTimeFound(reportObj) {
        reportObj.ignoredImages = _global.ignoredImages;
        reportObj.device = _global.device;

        _global.options.onTimeFound(reportObj);
    }

    function onStopObserving() {
        if (_global.hasStoppedObserve) {
            return;
        }
        _global.hasStoppedObserve = true;

        if (_global.mutationObserver) {
            _global.mutationObserver.disconnect();
        }

        clearInterval(_global.intervalDotTimer);

        // 记录当前时刻 dom 信息，且当前时刻为首屏图片数量等稳定的时刻
        recordDomInfo({ recordFirstScreen: true });

        // 向前递推，找到离稳定状态最近的渲染变动时刻
        var targetDotObj = _getTargetDotObj(_global.dotList);

        if (!targetDotObj) {
            console.log('[auto-compute-first-screen-time] no suitable time found.');
            _runOnTimeFound({
                firstScreenTime: -1,
                firstScreenTimeStamp: -1,
                maxErrorTime: -1,
                requests: util.transRequestDetails2Arr(_global),
                dotList: _global.dotList,
                firstScreenImages: _getImages({ searchInFirstScreen: true }),
                delayAll: _global.delayAll,
                delayFirstScreen: -1,
                type: 'none',
                isStaticPage: _global.isFirstRequestSent ? false : (_global.recordType === 'auto' ? true : 'unknown'),
                version: util.version,
                runtime: util.getTime() - scriptStartTime,
                // 添加额外字段用于调试
                reportDetail: 'dot-no-target'
            });
            return;
        }

        // 触发事件：所有异步请求已经发布完毕
        _global.options.onAllXhrResolved && _global.options.onAllXhrResolved(targetDotObj.timeStamp);

        // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
        _checkTargetDot(targetDotObj);
    }

    function _checkTargetDot(dotObj) {
        if (dotObj.isTargetDot && dotObj.firstScreenTimeStamp !== -1) {
            // 轮询修正 domComplete 的值
            if (dotObj.firstScreenTimeStamp === 0) {
                util.getDomCompleteTime(function (domCompleteStamp) {
                    dotObj.firstScreenTimeStamp = domCompleteStamp;
                    _runOnTargetDotFound(dotObj);
                });
            } else {
                _runOnTargetDotFound(dotObj);
            }
        }
    }

    // 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
    function insertTestTimeScript() {
        util.insertTestTimeScript(onStopObserving, _global);
    }

    // 监听 dom 变化，脚本运行时就开始
    function observeDomChange() {
        var lastObserverRunTime;

        var dotCallback = function (param) {
            var now = util.getTime();
            if (lastObserverRunTime && now - lastObserverRunTime < _global.options.dotDelay) {
                return;
            }

            lastObserverRunTime = now;

            recordDomInfo(param);
        };

        // 记录首屏 DOM 的变化
        _global.intervalDotTimer = setInterval(function () {
            dotCallback({ isFromInternal: true });
        }, _global.options.dotDelay);

        if (window.MutationObserver) {
            _global.mutationObserver = new window.MutationObserver(function () {
                dotCallback({ mutation: true });
            });
            _global.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        // 触发回调前，先记录初始时刻的 dom 信息
        dotCallback();
    }

    function overrideRequest() {
        util.overrideRequest(_global, onStopObserving);
    }

    function mergeUserOptions(userOptions) {
        util.mergeUserOptions(_global, userOptions);
    }

    return {
        mergeUserOptions: mergeUserOptions,
        insertTestTimeScript: insertTestTimeScript,
        observeDomChange: observeDomChange,
        overrideRequest: overrideRequest,
        recordDomInfo: recordDomInfo
    };
}

module.exports = {
    auto: function(userOptions) {
        var api = generateApi('auto');

        api.mergeUserOptions(userOptions);
        api.insertTestTimeScript();
        api.observeDomChange();
        api.overrideRequest();
    },
    hand: function(userOptions) {
        var api = generateApi('hand');
        
        api.mergeUserOptions(userOptions);
        api.recordDomInfo({
            isTargetDot: true,
            recordFirstScreen: true
        });
    }
};

