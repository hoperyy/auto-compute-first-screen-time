// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

var win = window;
var doc = win.document;
var util = require('./util');

function generateApi() {
    // 所有变量和函数定义在闭包环境，为了支持同时手动上报和自动上报功能

    var _global = util.mergeGlobal(util.initGlobal(), {
        options: {
            img: [/(\.)(png|jpg|jpeg|gif|webp)/i]
        }
    });

    function runOnPageStable() {
        if (_global.hasReported) {
            return;
        }

        _global.hasReported = true;

        _recordFirstScreenInfo();
    }

    function _runOnTimeFound(resultObj) {
        // 为 resultObj 添加 _global.ignoredImages 字段
        resultObj.ignoredImages = _global.ignoredImages;
        resultObj.device = _global.device;

        _global.options.onTimeFound(resultObj);
    }
 
    // 重操作：记录运行该方法时刻的 dom 信息，主要是 images
    function _recordFirstScreenInfo() {
        var startTime =  util.getTime();
        var firstScreenImages = _getImagesInFirstScreen().map(util.formateUrl);
        var endTime = util.getTime();

        // 找到最后一个图片加载完成的时刻，作为首屏时刻
        // 最终呈现给用户的首屏信息对象
        var resultObj = {
            type: 'perf',
            firstScreenImages: [],
            firstScreenImagesLength: 0,
            requests: util.transRequestDetails2Arr(_global),
            delayAll: endTime - startTime,
            delayFirstScreen: endTime - startTime,
            firstScreenTime: -1, // 需要被覆盖的
            firstScreenTimeStamp: -1, // 需要被覆盖的
        };

        if (!firstScreenImages.length) {
            util.getDomCompleteTime(function (domCompleteStamp) {
                resultObj.firstScreenTimeStamp = domCompleteStamp;
                resultObj.firstScreenTime = domCompleteStamp - util.NAV_START_TIME; 
                _runOnTimeFound(resultObj);
            });
        } else {
            var maxFetchTimes = 10;
            var fetchCount = 0;

            var getDomComplete = function () {
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
                var imgLoadTimeArr = [];
                for (i = 0, len = filteredSource.length; i < len; i++) {
                    var sourceItem = filteredSource[i];
                    var imgUrl = sourceItem.name;
                    if (firstScreenImages.indexOf(util.formateUrl(imgUrl)) !== -1) {
                        matchedLength++;
                        imgLoadTimeArr.push({
                            src: imgUrl,
                            responeEnd: sourceItem.responseEnd,
                            details: sourceItem
                        });
                    }
                }

                // 倒序
                imgLoadTimeArr.sort(function (a, b) {
                    return b.responeEnd - a.responeEnd;
                });

                // 如果 source 中有全部的首屏图片信息，则停止定时器并执行性能上报
                if (matchedLength === firstScreenImages.length) {
                    clearInterval(timer);

                    resultObj.firstScreenImages = firstScreenImages;
                    resultObj.firstScreenImagesLength = firstScreenImages.length;
                    resultObj.firstScreenTime = parseInt(imgLoadTimeArr[0].responeEnd);
                    resultObj.firstScreenTimeStamp = parseInt(imgLoadTimeArr[0].responeEnd) + util.NAV_START_TIME;

                    _runOnTimeFound(resultObj);
                }

                fetchCount++;
                if (fetchCount >= maxFetchTimes) {
                    clearInterval(timer);
                }
            };

            // 轮询多次获取 performance 信息，直到 performance 信息能够展示首屏资源情况
            var timer = setInterval(getDomComplete, 1000);

            getDomComplete();
        }
    }

    function _getImagesInFirstScreen() {
        var screenHeight = win.innerHeight;
        var screenWidth = win.innerWidth;

        // 写入设备信息，用于上报（这里只会执行一次）
        _global.device.screenHeight = screenHeight;
        _global.device.screenWidth = screenWidth;

        var nodeIterator = util.queryAllNode();
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
            var imgSrc = util._getImgSrcFromDom(currentNode);

            if (!imgSrc) {
                currentNode = nodeIterator.nextNode();
                continue;
            }

            util.recordCurrentPos(currentNode);

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
    function insertTestTimeScript() {
        util.insertTestTimeScript(runOnPageStable, _global);
    }

    function overrideRequest() {
        util.overrideRequest(_global, runOnPageStable);
    }

    function mergeUserOptions(userOptions) {
        util.mergeUserOptions(_global, userOptions);
        if (userOptions && userOptions.img) {
            if (typeof userOptions.img === 'object' && typeof userOptions.img.test === 'function') {
                _global.options.img.push(userOptions.img);
            } else {
                console.error('[auto-compute-first-screen-time] param "img" should be type RegExp');
            }
        }
    }

    return {
        mergeUserOptions: mergeUserOptions,
        insertTestTimeScript: insertTestTimeScript,
        overrideRequest: overrideRequest,
        runOnPageStable: runOnPageStable
    };
}

module.exports = {
    auto: function (userOptions) {
        var api = generateApi();
        api.mergeUserOptions(userOptions);
        api.insertTestTimeScript();
        api.overrideRequest();
    },
    hand: function (userOptions) {
        var api = generateApi();
        api.mergeUserOptions(userOptions);
        api.runOnPageStable();
    }
}
