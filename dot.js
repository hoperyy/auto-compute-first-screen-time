// 降级算法，该算法消耗一部分的性能，用于不支持 performance API 的场景，依赖 window.performance.timing

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

var win = window;
var doc = win.document;
var util = require('./util');

var acftGlobal = require('./global-info');

var globalIndex = 0;

function generateApi() {
    var _global = util.mergeGlobal(util.initGlobal(), {
        intervalDotTimer: null,

        // 是否已经停止监听的标志
        hasStoppedObserve: false,

        // 打点数组
        dotList: [],

        // 记录图片加载完成的时刻（唯一）
        imgMap: {},

        // 打点间隔
        dotDelay: 250,

        abortTimeWhenDelay: 500 // 监控打点会引起页面重绘，如果引发页面重绘的时间超过了该值，则不再做性能统计
    });

    _global.globalIndex = 'dot-' + globalIndex++;

    util.watchDomUpdate(_global);

    function _getTargetDotObj() {
        // 按照打点时刻倒序
        _global.dotList.sort(function (a, b) {
            if (a.dotTimeStamp < b.dotTimeStamp) {
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

            // 如果仍然没有找到 targetInfo，则取稳定状态的值
            if (!targetInfo) {
                targetInfo = _global.dotList[0];
            }
        } else {
            // 如果最终状态没有图片，则取出当前打点的对象，首屏时间设置为 performance 值
            targetInfo = _global.dotList[0];
            targetInfo.firstScreenTimeStamp = performance.timing.domComplete; // 有 bug，过早获取时该值可能为 0
            targetInfo.firstScreenTime = performance.timing.domComplete - _global.forcedNavStartTimeStamp;
        }

        return targetInfo;
    }

    // 只会执行一次
    function _report(targetDotObj) {
        var stableDotObj = _global.dotList[0];

        var generateResultObj = function() {
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
                if (_global.dotList[i].delay) {
                    if (_global.dotList[i].dotTimeStamp <= targetDotObj.dotTimeStamp) {
                        delayFirstScreen += _global.dotList[i].delay;
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
                success: true,
                maxErrorTime: targetDotObj.maxErrorTime, // 最大误差值
                dotList: _global.dotList, // 打点列表
                isStaticPage: _global.isFirstRequestSent ? false : (/auto/.test(_global.reportDesc) ? true : 'unknown'), // 是否是静态页面（没有请求发出）
                requests: util.transRequestDetails2Arr(_global), // 监控期间拦截的请求
                firstScreenTime: targetDotObj.firstScreenTimeStamp - _global.forcedNavStartTimeStamp, // 首屏时长
                firstScreenTimeStamp: targetDotObj.firstScreenTimeStamp, // 首屏结束的时刻
                firstScreenImages: stableDotObj.firstScreenImages, // 首屏图片列表，必须使用稳定时刻的值
                firstScreenImagesLength: stableDotObj.firstScreenImages.length, // 首屏图片数量，必须使用稳定时刻的值
                firstScreenImagesDetail: targetDotObj.firstScreenImagesDetail, // 首屏图片细节，使用目标打点的数据
                navigationStartTimeStamp: _global.forcedNavStartTimeStamp,
                navigationStartTime: _global.forcedNavStartTimeStamp - _global._originalNavStart,
                isOriginalNavStart: _global.forcedNavStartTimeStamp === _global._originalNavStart,
                delayFirstScreen: delayFirstScreen, // 计算引发的首屏时间 delay
                delayAll: _global.delayAll, // 计算引发的总 delay
                type: 'dot',
                version: util.version,
                runtime: util.getTime() - scriptStartTime, // 检测脚本运行的时长
                reportDesc: _global.reportDesc,
                url: window.location.href.substring(0, 200), // 当前页面 url
                ignoredImages: _global.ignoredImages, // 计算首屏时被忽略的图片
                device: _global.device, // 当前设备信息
                globalIndex: _global.globalIndex,
                domChangeList: _global.domChangeList, // dom 变化数组
                navigationTagChangeMap: acftGlobal.navigationTagChangeMap,
                reportTimeFrom: targetDotObj.reportTimeFrom
            };

            return resultObj;
        }

        var canReport = function () {
            // 如果退出上报，则直接返回
            if (_global.hasReported) {
                return false;
            }

            if (_global.abortReport) {
                return false;
            }

            return true;
        };

        if (_global.abortByDelayTimeout) {
            // 上报
            _global.onReport({
                success: false,
                delayFirstScreen: _global.delayAll,
                abortTimeSetting: _global.abortTimeWhenDelay,
                url: window.location.href.substring(0, 200),
                dotList: _global.dotList,
                globalIndex: _global.globalIndex,
                type: 'dot'
            });
            return;
        }

        var resultObj = generateResultObj();
        
        if (_global.delayReport) {
            var timer = setTimeout(function () {
                if (canReport()) {
                    _global.onReport(resultObj);
                    _global.hasReported = true;
                }
                
                clearTimeout(timer);
            }, _global.delayReport);
        } else {
            if (canReport()) {
                _global.onReport(resultObj);
                _global.hasReported = true;
            }
        }
    }

    // 记录运行该方法时刻的 dom 信息，主要是 images；运行时机为定时器触发
    function recordDomInfo(param) {
        var recordFirstScreen = param && param.recordFirstScreen;

        // 如果在打点过程中，并且性能监控打点引发的渲染 delay 超过了设置的阈值，则停止性能监控打点
        if (_global.delayAll >= _global.abortTimeWhenDelay) {
            _global.abortByDelayTimeout = true;
            return;
        }

        var recordStartTime = util.getTime();

        var firstScreenImages = _getImages({ searchInFirstScreen: recordFirstScreen });

        var recordEndTime = util.getTime();

        _global.delayAll += recordEndTime - recordStartTime;

        var dotObj = {
            isImgInFirstScreen: recordFirstScreen || false,
            isFromInternal: (param && param.isFromInternal) ? true : false,
            firstScreenImages: firstScreenImages, // 此时打点的首屏图片数组
            firstScreenImagesLength: firstScreenImages.length, // 有几张首屏图片
            dotIndex: _global.dotList.length, // 打点索引
            dotTimeStamp: recordStartTime, // 打点时刻
            dotTimeDuration: recordStartTime - _global.forcedNavStartTimeStamp,
            delay: recordEndTime - recordStartTime, // 此次打点持续了多久

            // 标记该打点时刻抓到的图片是否全部 onload，后面会被修正
            finished: false,

            // 如果该打点是目标打点，下面各值会被修正
            isTargetDot: (param && param.isTargetDot) || false, // 默认是 false, 除非手动设置是目标打点（用于手动埋点）
            firstScreenTimeStamp: -1, // 当前时刻下，所有图片加载完毕的时刻
            reportTimeFrom: '',
            firstScreenImagesDetail: [],
            maxErrorTime: 'unkown' // 误差值
        };

        _global.dotList.push(dotObj);

        if (!firstScreenImages.length) {
            dotObj.finished = true;
        } else {
            var imgIndex = 0;
            var afterDownload = function (src) {
                imgIndex++;

                // 如果当前打点处，所有图片均已加载完毕，标记该打点已经完成
                if (imgIndex === firstScreenImages.length) {
                    dotObj.finished = true;
                }
            };

            var generateGlobalImgMapResult = function (options) {
                var time = util.getTime();
                return {
                    loadTimeStamp: time,
                    loadDuration: time - _global.forcedNavStartTimeStamp,
                    maxErrorTime: options.maxErrorTime,
                    type: options.type
                }
            };

            util.forEach(firstScreenImages, function (src) {
                if (_global.imgMap[src]) {
                    afterDownload(src);
                } else {
                    var img = new Image();
                    img.src = util.formateUrlByAdd(src);

                    if (img.complete) {
                        // 记录该图片加载完成的时间，以最早那次为准
                        if (!_global.imgMap[src]) {
                            var currentImgMaxErrorTime = _global.dotList[dotObj.dotIndex - 1] ? (dotObj.dotTimeStamp - _global.dotList[dotObj.dotIndex - 1].dotTimeStamp) : 0;
                            _global.imgMap[src] = generateGlobalImgMapResult({
                                maxErrorTime: currentImgMaxErrorTime, 
                                type: 'complete'
                            });
                        }
                        afterDownload(src);
                    } else {
                        img.onload = img.onerror = function () {
                            // 记录该图片加载完成的时间，以最早那次为准
                            if (!_global.imgMap[src]) {
                                _global.imgMap[src] = generateGlobalImgMapResult({
                                    maxErrorTime: 0,
                                    type: 'onload'
                                });
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

        var nodeIterator = util.queryAllNode(_global.ignoreTag);
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
            var imgSrc = util.getImgSrcFromDom(currentNode, _global.img);

            // 如果没有 imgSrc，则直接读取下一个 dom 的信息
            if (!imgSrc) {
                currentNode = nodeIterator.nextNode();
                continue;
            }

            if (searchInFirstScreen) {
                util.recordCurrentPos(currentNode, _global);

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

    function onStopObserving() {
        if (_global.hasStoppedObserve) {
            return;
        }

        _global.hasStoppedObserve = true;

        // 标记停止监听请求
        _global.stopCatchingRequest = true;

        util.stopWatchDomUpdate(_global);
        util.stopCatchingRequest(_global);

        clearInterval(_global.intervalDotTimer);

        // 记录当前时刻 dom 信息，且当前时刻为首屏图片数量等稳定的时刻
        recordDomInfo({ recordFirstScreen: true });

        // 向前递推，找到离稳定状态最近的打点对象
        var targetDotObj = _getTargetDotObj(_global.dotList);

        _global.onStableStatusFound(targetDotObj);

        targetDotObj.isTargetDot = true;

        // 触发事件：所有异步请求已经发布完毕
        _global.onAllXhrResolved && _global.onAllXhrResolved(targetDotObj.dotTimeStamp);

        // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
        var checkTimer = null;
        var check = function () {
            if (targetDotObj.finished) {
                reportTargetDotObj(targetDotObj);
                clearInterval(checkTimer);

                // clear todo
            }
        };
        checkTimer = setInterval(check, 1000);
        check();
    }

    // 此时所有图片均已 onload
    function reportTargetDotObj(targetDotObj) {
        var stableDotObj = _global.dotList[0];

        var _getFirstScreenImageDetailsFromDot = function() {
            var firstScreenImagesDetail = [];
            var firstScreenImages = stableDotObj.firstScreenImages; // 首屏图片，必须使用稳定时刻的值

            for (var i = 0, len = firstScreenImages.length; i < len; i++) {
                var imgMapKey = firstScreenImages[i];
                var imgItem = _global.imgMap[imgMapKey];
                if (imgItem) {
                    firstScreenImagesDetail.push({
                        src: imgMapKey,
                        type: imgItem['type'],
                        maxErrorTime: imgItem['maxErrorTime'],
                        loadTimeStamp: imgItem['loadTimeStamp'],
                        loadDuration: imgItem['loadDuration'],
                        from: 'dot'
                    });
                }
            }

            firstScreenImagesDetail.sort(function (a, b) {
                return b.loadDuration - a.loadDuration;
            });

            return firstScreenImagesDetail;
        }
        var whenNoImages = function() {
            if (/^hand/.test(_global.reportDesc)) {
                targetDotObj.firstScreenTimeStamp = _global.handExcuteTime;
                targetDotObj.reportTimeFrom = 'dot-hand-from-force';
                targetDotObj.firstScreenImagesDetail = _getFirstScreenImageDetailsFromDot();
                _report(targetDotObj);
            } else {
                util.getDomReadyTime(_global, function (domReadyTimeStamp, reportTimeFrom) {
                    targetDotObj.firstScreenTimeStamp = domReadyTimeStamp;
                    targetDotObj.reportTimeFrom = reportTimeFrom;
                    targetDotObj.firstScreenImagesDetail = _getFirstScreenImageDetailsFromDot();
                    _report(targetDotObj);
                });
            }
        };

        var whenHasImages = function() {
            var _getLastImgDownloadDetailFromDot = function(images) {
                var timeArr = [];

                util.forEach(images, function (src) {
                    timeArr.push(_global.imgMap[src]);
                });

                // 倒序
                timeArr.sort(function (a, b) {
                    if (a.loadTimeStamp < b.loadTimeStamp) {
                        return 1;
                    } else {
                        return -1;
                    }
                });

                return timeArr[0];
            };

            var generateResultFromDot = function (reportTimeFrom) {
                var lastImgDownloadDetail = _getLastImgDownloadDetailFromDot(stableDotObj.firstScreenImages);
                targetDotObj.firstScreenTimeStamp = lastImgDownloadDetail.loadTimeStamp; // 获取此次打点最后一张图片 onload 的时刻
                targetDotObj.maxErrorTime = lastImgDownloadDetail.maxErrorTime; // 获取此次打点时最后一张图片 onload 时间的误差值
                targetDotObj.reportTimeFrom = reportTimeFrom;
                targetDotObj.firstScreenImagesDetail = _getFirstScreenImageDetailsFromDot();
                _report(targetDotObj);
            };

            // 如果支持 performance API，则从 performance 中获取图片真实的返回时间
            if (acftGlobal.supportPerformance) {
                var isLastImageTimeFromOnload = function () {
                    var lastImgDownloadDetail = _getLastImgDownloadDetailFromDot(stableDotObj.firstScreenImages);
                    if (lastImgDownloadDetail && lastImgDownloadDetail.type === 'onload') {
                        return true;
                    }
                    return false;
                };

                // 如果图片全部是通过 onload 获取的时间，优先从打点信息中；否则从 performance 数据取
                if (isLastImageTimeFromOnload()) {
                    generateResultFromDot('dot-img-from-onload');
                } else {
                    util.cycleGettingPerformaceTime(_global, stableDotObj.firstScreenImages, function (performanceResult) {
                        targetDotObj.firstScreenImagesDetail = performanceResult.firstScreenImagesDetail;

                        // 如果图片在上一个页面已经加载完毕，则还是通过打点记录的 onload 时间作为首屏时间
                        if (performanceResult.firstScreenTimeStamp <= _global.forcedNavStartTimeStamp) {
                            generateResultFromDot('dot-img-from-prepage-load');
                        } else {
                            // 如果图片在当前页面加载完毕，则通过 performance 获取首屏时间
                            targetDotObj.firstScreenTimeStamp = performanceResult.firstScreenTimeStamp;
                            targetDotObj.maxErrorTime = 0;
                            targetDotObj.reportTimeFrom = 'dot-img-from-performance';
                            _report(targetDotObj);
                        }
                    });
                }
            } else { // 如果不支持 performance API，则从打点信息中获取图片返回时间
                generateResultFromDot('dot-img-from-onload');
            }
        };

        if (targetDotObj.firstScreenImages.length === 0) {
            whenNoImages();
        } else {
            whenHasImages();
        }
    }

    // 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
    function testStaticPage() {
        util.testStaticPage(function() {
            onStopObserving('dot-timeout');
        }, _global);
    }

    // 监听 dom 变化，脚本运行时就开始
    function observeDomChange() {
        var lastObserverRunTime;

        var dotCallback = function (param) {
            var now = util.getTime();
            if (lastObserverRunTime && now - lastObserverRunTime < _global.dotDelay) {
                return;
            }

            lastObserverRunTime = now;

            recordDomInfo(param);
        };

        // 记录首屏 DOM 的变化
        _global.intervalDotTimer = setInterval(function () {
            dotCallback({ isFromInternal: true });
        }, _global.dotDelay);

        // 触发回调前，先记录初始时刻的 dom 信息
        dotCallback();
    }

    function overrideRequest() {
        util.overrideRequest(_global, function () {
            onStopObserving('dot-request-end');
        });
    }

    function mergeUserConfig(userConfig) {
        util.mergeUserConfig(_global, userConfig);
    }

    return {
        mergeUserConfig: mergeUserConfig,
        testStaticPage: testStaticPage,
        observeDomChange: observeDomChange,
        overrideRequest: overrideRequest,
        recordDomInfo: recordDomInfo,
        onStopObserving: onStopObserving,
        global: _global
    };
}

module.exports = {
    auto: function(userConfig) {
        var go = function () {
            var api = generateApi();
            api.global.reportDesc = 'auto-dot';
            api.mergeUserConfig(userConfig);
            api.testStaticPage();
            api.observeDomChange();
            api.overrideRequest();
            return api;
        };

        var api = go();

        var preGlobal = api.global;
        util.onNavigationStartChange(api.global, function (changeInfo) {
            preGlobal.abortReport = true;

            // 触发用户注册的回调
            preGlobal.onNavigationStartChange(changeInfo);

            // 下次启动首屏时间计算，设置 navStart 的时刻
            userConfig.forcedNavStartTimeStamp = changeInfo.timeStamp;

            // 重新运行首屏时间计算，需要使用 dot 的方式
            preGlobal = go().global;
        });

        return api.global;
    },
    hand: function(userConfig) {
        var api = generateApi();
        api.global.reportDesc = 'hand-dot';
        api.global.handExcuteTime = new Date().getTime();
        api.mergeUserConfig(userConfig);
        api.onStopObserving();
    }
};

