// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

var win = window;
var doc = win.document;
var util = require('./util');

var globalIndex = 0;

function generateApi() {

    // 所有变量和函数定义在闭包环境，为了支持同时手动上报和自动上报功能
    var _global = util.mergeGlobal(util.initGlobal(), {
        hasStableFound: false
    });

    _global.globalIndex = 'perf-' + globalIndex++;

    util.watchDomUpdate(_global);

    function runOnPageStable() {
        // 标记稳定时刻已经找到
        if (_global.hasStableFound) {
            return;
        }

        util.stopWatchDomUpdate(_global);

        _global.hasStableFound = true;

        // 标记停止监听请求
        _global.stopCatchingRequest = true;

        // 获取当前时刻获取的首屏信息，并根据该信息获取首屏时间
        var stableObject = recordFirstScreenInfo();

        // 触发用户注册的回调
        _global.onStableStatusFound(stableObject);
    }

    function _report(resultObj) {
        var handler = function() {
            // 如果退出上报，则直接返回
            if (_global.abortReport) {
                return;
            }

            // 如果从计算开始到上报的过程中，perfStart 有变化，则不再上报性能
            if (_global._perfStartChanged) {
                return;
            }

            _global.abortReport = true;

            // 为 resultObj 添加 _global.ignoredImages 字段
            resultObj.ignoredImages = _global.ignoredImages;
            resultObj.device = _global.device;
            resultObj.success = true;

            _global.onReport(resultObj);

            // clear todo
        };

        if (_global.delayReport) {
            var timer = setTimeout(function() {
                handler();
                clearTimeout(timer);
            }, _global.delayReport);
        } else {
            handler();
        }
    }
 
    // 重操作：记录运行该方法时刻的 dom 信息，主要是 images
    function recordFirstScreenInfo() {
        var startTime =  util.getTime();
        var firstScreenImages = _getImagesInFirstScreen().map(util.formateUrl);
        var endTime = util.getTime();
        var firstScreenImagesDetail = [];

        // 找到最后一个图片加载完成的时刻，作为首屏时刻
        // 最终呈现给用户的首屏信息对象
        var resultObj = {
            type: 'perf',
            isStaticPage: _global.isFirstRequestSent ? false : (/auto/.test(_global.reportDesc) ? true : 'unknown'),
            firstScreenImages: [],
            firstScreenImagesLength: 0,
            firstScreenImagesDetail: firstScreenImagesDetail,
            requests: util.transRequestDetails2Arr(_global),
            delayAll: endTime - startTime,
            delayFirstScreen: endTime - startTime,
            firstScreenTime: -1, // 需要被覆盖的
            firstScreenTimeStamp: -1, // 需要被覆盖的
            navigationStart: _global.forcedNavStartTimeStamp,
            isOriginalNavStart: _global.forcedNavStartTimeStamp === performance.timing.navigationStart,
            version: util.version,
            runtime: util.getTime() - scriptStartTime,
            reportDesc: _global.reportDesc,
            url: window.location.href.substring(0, 200),
            globalIndex: _global.globalIndex,
            domChangeList: _global.domChangeList
        };

        if (!firstScreenImages.length) {
            if (/^hand/.test(_global.reportDesc)) {
                resultObj.firstScreenTimeStamp = _global.handExcuteTime;
                resultObj.firstScreenTime = _global.handExcuteTime - _global._originalNavStart;
                _report(resultObj);
            } else {
                util.getLastDomUpdateTime(_global, function (lastDomUpdateStamp) {
                    resultObj.firstScreenTimeStamp = lastDomUpdateStamp;
                    resultObj.firstScreenTime = lastDomUpdateStamp - _global._originalNavStart;
                    _report(resultObj);
                });
            }
        } else {
            var maxFetchTimes = 10;
            var fetchCount = 0;

            var getCompleteTime = function () {
                var source = performance.getEntries();
                var matchedLength = 0;
                var i;
                var len;

                // source 去重
                var filteredSource = [];
                var sourceMap = {};
                for (i = 0, len = source.length; i < len; i++) {
                    var sourceItem = source[i];
                    var url = sourceItem.name;
                    if (!sourceMap[url]) {
                        sourceMap[url] = true;
                        filteredSource.push(sourceItem);
                    }
                }

                // 从 source 中找到图片加载信息
                for (i = 0, len = filteredSource.length; i < len; i++) {
                    var sourceItem = filteredSource[i];
                    var imgUrl = sourceItem.name;
                    if (firstScreenImages.indexOf(util.formateUrl(imgUrl)) !== -1) {
                        matchedLength++;

                        var responseEnd = parseInt(sourceItem.responseEnd);
                        var fetchStart = parseInt(sourceItem.fetchStart);
                        firstScreenImagesDetail.push({
                            src: imgUrl,
                            responseEnd: responseEnd < 0 ? 0 : responseEnd,
                            fetchStart: fetchStart < 0 ? 0 : fetchStart
                        });
                    }
                }

                // 倒序
                firstScreenImagesDetail.sort(function (a, b) {
                    return b.responseEnd - a.responseEnd;
                });

                // 如果 source 中有全部的首屏图片信息，则停止定时器并执行性能上报
                if (matchedLength === firstScreenImages.length) {
                    clearInterval(timer);

                    resultObj.firstScreenImages = firstScreenImages;
                    resultObj.firstScreenImagesLength = firstScreenImages.length;

                    resultObj.firstScreenTime = parseInt(firstScreenImagesDetail[0].responseEnd);
                    resultObj.firstScreenTimeStamp = parseInt(firstScreenImagesDetail[0].responseEnd) + _global._originalNavStart;

                    _report(resultObj);
                }

                fetchCount++;
                if (fetchCount >= maxFetchTimes) {
                    clearInterval(timer);
                }
            };

            // 轮询多次获取 performance 信息，直到 performance 信息能够展示首屏资源情况
            var timer = setInterval(getCompleteTime, 1000);

            getCompleteTime();
        }

        return resultObj;
    }

    function _getImagesInFirstScreen() {
        var screenHeight = win.innerHeight;
        var screenWidth = win.innerWidth;

        // 写入设备信息，用于上报（这里只会执行一次）
        _global.device.screenHeight = screenHeight;
        _global.device.screenWidth = screenWidth;

        var nodeIterator = util.queryAllNode(_global.ignoreTag);
        var currentNode = nodeIterator.nextNode();
        var imgList = [];

        var onImgSrcFound = function (imgSrc) {
            var protocol = util.parseUrl(imgSrc).protocol;
            if (protocol && protocol.indexOf('http') === 0) {
                // 去重
                if (imgList.indexOf(imgSrc) === -1) {
                    imgList.push(imgSrc);
                }
            }
        }

        while (currentNode) {
            var imgSrc = util.getImgSrcFromDom(currentNode, _global.img);

            if (!imgSrc) {
                currentNode = nodeIterator.nextNode();
                continue;
            }

            util.recordCurrentPos(currentNode, _global);

            if (util.isInFirstScreen(currentNode)) {
                onImgSrcFound(imgSrc);
            } else {
                var currentPos = util.currentPos;
                // 统计没有在首屏的图片信息
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

            currentNode = nodeIterator.nextNode();
        }

        return imgList;
    }

    // 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
    function testStaticPage() {
        util.testStaticPage(function() {
            runOnPageStable('perf-auto-timeout');   
        }, _global);
    }

    function overrideRequest() {
        util.overrideRequest(_global, function () {
            runOnPageStable('perf-auto-request-end');
        });
    }

    function mergeUserConfig(userConfig) {
        util.mergeUserConfig(_global, userConfig);
    }

    return {
        mergeUserConfig: mergeUserConfig,
        testStaticPage: testStaticPage,
        overrideRequest: overrideRequest,
        recordFirstScreenInfo: recordFirstScreenInfo,
        global: _global
    };
}

module.exports = {
    auto: function (userConfig) {
        var go = function () {
            var api = generateApi('auto');
            api.global.reportDesc = 'auto-perf';
            api.mergeUserConfig(userConfig);
            api.testStaticPage();
            api.overrideRequest();
            return api;
        };

        var api = go();

        // 单页应用才会出现重新设置 perf-start 的情况
        var preGlobal = api.global;
        util.onNavigationStartChange(api.global, function (prePerfStartTimeStamp, curPerfStartTimeStamp) {
            preGlobal._perfStartChanged = true;

            // 触发用户注册的回调
            preGlobal.onNavigationStartChange(prePerfStartTimeStamp, curPerfStartTimeStamp);

            // 下次启动首屏时间计算，设置 navStart 的时刻
            userConfig.forcedNavStartTimeStamp = curPerfStartTimeStamp;

            // 重新运行首屏时间计算，但需要使用 dot 的方式
            preGlobal = require('./dot').auto(userConfig);
        });

        return api.global;
    },
    hand: function (userConfig) {
        var api = generateApi('hand');
        api.global.reportDesc = 'hand-perf';
        api.global.handExcuteTime = new Date().getTime();
        api.mergeUserConfig(userConfig);
        api.recordFirstScreenInfo('perf-hand');
    }
}
