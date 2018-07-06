// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

var win = window;
var doc = win.document;
var NAV_START_TIME = window.performance.timing.navigationStart;
var util = require('./util');

function generateApi() {
    // 所有变量和函数定义在闭包环境，为了支持同时手动上报和自动上报功能

    var global = initGlobal();

    function initGlobal() {
        return {
            // 是否已经上报的标志
            hasReported: false,

            // 是否抓取过请求的标志位
            isFirstRequestSent: false,

            // 可以抓取请求的时间窗口队列
            catchRequestTimeSections: [],

            // 统计没有被计入首屏的图片有哪些，和更详细的信息
            ignoredImages: [],

            // 设备信息，用于样本分析
            device: {},

            requestDetails: {},

            // 一些可配置项，下面是默认值
            options: {
                onTimeFound: function () { },
                request: {
                    limitedIn: [],
                    exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
                },

                // 获取数据后，认为渲染 dom 的时长；同时也是串联请求的等待间隔
                renderTimeAfterGettingData: 500,

                // 找到首屏时间后，延迟上报的时间，默认为 500ms，防止页面出现需要跳转到登录导致性能数据错误的问题
                delayReport: 500,

                // onload 之后延时一段时间，如果到期后仍然没有异步请求发出，则认为是纯静态页面
                watingTimeWhenDefineStaticPage: 1000,

                img: [/(\.)(png|jpg|jpeg|gif|webp)/i]
            }
        }
    }

    function _parseUrl(url) {
        var anchor = document.createElement('a');
        anchor.href = url;
        return anchor;
    }

    function runOnPageStable() {
        if (global.hasReported) {
            return;
        }

        global.hasReported = true;

        _recordFirstScreenInfo();
    }

    function _formateUrl(url) {
        return url.replace(/^http(s)?\:/, '').replace(/^\/\//, '');
    }

    function _runOnTimeFound(resultObj) {
        // 为 resultObj 添加 global.ignoredImages 字段
        resultObj.ignoredImages = global.ignoredImages;
        resultObj.device = global.device;

        global.options.onTimeFound(resultObj);
    }

    function _transRequestDetails2Arr() {
        var requests = [];
        var requestItem = {};

        // 规范化 requests
        for (var requestDetailKey in global.requestDetails) {
            var parsedRequestDetailKey = requestDetailKey
                .split(">time")[0]
                .replace(/^http(s)?:/, '')
                .replace(/^\/\//, '');

            requestItem = {
                src: parsedRequestDetailKey
            };

            for (var requestItemkey in global.requestDetails[requestDetailKey]) {
                requestItem[requestItemkey] = global.requestDetails[requestDetailKey][requestItemkey];
            }

            requests.push(requestItem);
        }

        return requests;
    }

    // 重操作：记录运行该方法时刻的 dom 信息，主要是 images
    function _recordFirstScreenInfo() {
        var startTime = new Date().getTime();
        var firstScreenImages = _getImagesInFirstScreen().map(_formateUrl);
        var endTime = new Date().getTime();

        // 找到最后一个图片加载完成的时刻，作为首屏时刻
        // 最终呈现给用户的首屏信息对象
        var resultObj = {
            type: 'perf',
            firstScreenImages: [],
            firstScreenImagesLength: 0,
            requests: _transRequestDetails2Arr(),
            delayAll: endTime - startTime,
            delayFirstScreen: endTime - startTime,
            firstScreenTime: -1, // 需要被覆盖的
            firstScreenTimeStamp: -1, // 需要被覆盖的
        };

        if (!firstScreenImages.length) {
            util.getDomCompleteTime(function (domCompleteStamp) {
                resultObj.firstScreenTimeStamp = domCompleteStamp;
                resultObj.firstScreenTime = domCompleteStamp - NAV_START_TIME; 
                _runOnTimeFound(resultObj);
            });
        } else {
            var maxFetchTimes = 10;
            var fetchCount = 0;

            // 轮询多次获取 performance 信息，直到 performance 信息能够展示首屏资源情况
            var timer = setInterval(function () {
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
                    if (firstScreenImages.indexOf(_formateUrl(imgUrl)) !== -1) {
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
                    resultObj.firstScreenTimeStamp = parseInt(imgLoadTimeArr[0].responeEnd) + NAV_START_TIME;

                    _runOnTimeFound(resultObj);
                }

                fetchCount++;
                if (fetchCount >= maxFetchTimes) {
                    clearInterval(timer);
                }
            }, 1000);
        }
    }

    function _queryImages(isInFirstScreen, success) {
        var screenHeight = win.innerHeight;

        var nodeIterator = doc.createNodeIterator(
            doc.body,
            NodeFilter.SHOW_ELEMENT,
            function (node) {
                if (node.nodeName.toUpperCase() == 'IMG') {
                    return NodeFilter.FILTER_ACCEPT;
                } else if (win.getComputedStyle(node).getPropertyValue('background-image') !== 'none') { // win.getComputedStyle 会引起重绘
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        var currentNode = nodeIterator.nextNode();
        var imgList = [];
        while (currentNode) {
            if (!isInFirstScreen(currentNode)) {
                currentNode = nodeIterator.nextNode();
                continue;
            }

            var src = '';
            if (currentNode.nodeName.toUpperCase() == 'IMG') {
                src = currentNode.getAttribute('src');
            } else {
                var bgImg = win.getComputedStyle(currentNode).getPropertyValue('background-image'); // win.getComputedStyle 会引起重绘
                var match = bgImg.match(/^url\(['"](.+\/\/.+)['"]\)$/);
                src = match && match[1];
            }

            var protocol = _parseUrl(src).protocol;
            if (src && protocol && protocol.indexOf('http') === 0) {
                success(src);
            }

            currentNode = nodeIterator.nextNode();
        }
    }

    function _getImagesInFirstScreen() {
        var screenHeight = win.innerHeight;
        var screenWidth = win.innerWidth;

        // 写入设备信息，用于上报（这里只会执行一次）
        global.device.screenHeight = screenHeight;
        global.device.screenWidth = screenWidth;

        var imgList = [];

        _queryImages(function (currentNode) {
            // 过滤函数，如果符合要求，返回 true
            var boundingClientRect = currentNode.getBoundingClientRect();

            // 如果已不显示（display: none），top 和 bottom 均为 0
            if (!boundingClientRect.top && !boundingClientRect.bottom) {
                return false;
            }

            var scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;

            var top = boundingClientRect.top; // getBoundingClientRect 会引起重绘
            var left = boundingClientRect.left;
            var right = boundingClientRect.right;

            // 如果在结构上的首屏内（上下、左右）
            if ((scrollTop + top) <= screenHeight && right >= 0 && left <= screenWidth) {
                return true;
            } else {
                var src = '';
                if (currentNode.nodeName.toUpperCase() == 'IMG') {
                    src = currentNode.getAttribute('src');
                } else {
                    var bgImg = win.getComputedStyle(currentNode).getPropertyValue('background-image'); // win.getComputedStyle 会引起重绘
                    var match = bgImg.match(/^url\(['"](.+\/\/.+)['"]\)$/);
                    src = match && match[1];
                }
                global.ignoredImages.push({
                    src: src,
                    screenHeight: screenHeight,
                    screenWidth: screenWidth,
                    scrollTop: scrollTop,
                    top: top,
                    vertical: (scrollTop + top) <= screenHeight,
                    left: left,
                    right: right,
                    horizontal: right >= 0 && left <= screenWidth
                });
            }
        }, function (src) {
            // 去重
            if (imgList.indexOf(src) === -1) {
                imgList.push(src);
            }
        });

        return imgList;
    }

    // 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
    function insertTestTimeScript() {
        window.addEventListener('load', function () {
            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                // clear
                clearTimeout(timer);

                if (!global.isFirstRequestSent) {
                    runOnPageStable();
                }
            }, global.options.watingTimeWhenDefineStaticPage);
        });
    }

    function overrideRequest() {
        var requestTimerStatusPool = {};

        var hasAllReuestReturned = function () {
            for (var key in global.requestDetails) {
                if (global.requestDetails[key] && global.requestDetails[key].status !== 'complete') {
                    return false;
                }
            }

            return true;
        };

        var isRequestTimerPoolEmpty = function () {
            for (var key in requestTimerStatusPool) {
                if (requestTimerStatusPool[key] !== 'stopped') {
                    return false;
                }
            }

            return true;
        };

        var shouldCatchThisRequest = function (url) {
            // 默认抓取该请求到队列，认为其可能影响首屏
            var shouldCatch = true;

            // 如果已经上报，则不再抓取请求
            if (global.hasReported) {
                shouldCatch = false;
            }

            var sendTime = new Date().getTime();

            // 如果发送数据请求的时间点在时间窗口内，则认为该抓取该请求到队列，主要抓取串联型请求
            for (var sectionIndex = 0; sectionIndex < global.catchRequestTimeSections.length; sectionIndex++) {
                var poolItem = global.catchRequestTimeSections[sectionIndex];
                if (sendTime >= poolItem[0] && sendTime <= poolItem[1]) {
                    break;
                }
            }
            if (global.catchRequestTimeSections.length && sectionIndex === global.catchRequestTimeSections.length) {
                shouldCatch = false;
            }

            // 如果发送请求地址不符合白名单和黑名单规则。则认为不该抓取该请求到队列
            for (var i = 0, len = global.options.request.limitedIn.length; i < len; i++) {
                if (!global.options.request.limitedIn[i].test(url)) {
                    shouldCatch = false;
                }
            }

            for (var i = 0, len = global.options.request.exclude.length; i < len; i++) {
                if (global.options.request.exclude[i].test(url)) {
                    shouldCatch = false;
                }
            }

            return shouldCatch;
        }

        var ensureRequestDetail = function (requestKey) {
            if (!global.requestDetails[requestKey]) {
                global.requestDetails[requestKey] = {
                    status: '',
                    completeTimeStamp: '',
                    completeTime: '',
                    type: ''
                };
            }
        };

        var onRequestSend = function (url, type) {
            if (!global.isFirstRequestSent) {
                global.isFirstRequestSent = true;
            }

            var requestKey = url + '>time:' + new Date().getTime();
            ensureRequestDetail(requestKey);

            global.requestDetails[requestKey].status = 'sent';
            global.requestDetails[requestKey].type = type;

            requestTimerStatusPool[requestKey] = 'start';

            return {
                requestKey: requestKey
            }
        };


        var afterRequestReturn = function (requestKey) {
            //  当前时刻
            var returnTime = new Date().getTime();

            ensureRequestDetail(requestKey);

            // 标记这个请求完成
            global.requestDetails[requestKey].status = 'complete';
            global.requestDetails[requestKey].completeTimeStamp = returnTime;
            global.requestDetails[requestKey].completeTime = returnTime - NAV_START_TIME;

            // 从这个请求返回的时刻起，延续一段时间，该时间段内的请求也需要被监听
            global.catchRequestTimeSections.push([returnTime, returnTime + global.options.renderTimeAfterGettingData]);

            var renderDelayTimer = setTimeout(function () {
                requestTimerStatusPool[requestKey] = 'stopped';
                if (hasAllReuestReturned() && isRequestTimerPoolEmpty()) {
                    runOnPageStable();
                }
                clearTimeout(renderDelayTimer);
            }, global.options.renderTimeAfterGettingData);
        };

        var overideXhr = function (onRequestSend, afterRequestReturn) {
            var XhrProto = XMLHttpRequest.prototype;
            var oldXhrSend = XhrProto.send;
            XhrProto.send = function () {
                if (shouldCatchThisRequest(this._http.url)) {
                    var requestKey = onRequestSend(this._http.url, 'xhr').requestKey;

                    var oldReadyCallback = this.onreadystatechange;
                    this.onreadystatechange = function () {
                        if (this.readyState === 4) {
                            afterRequestReturn(requestKey);
                        }

                        if (oldReadyCallback && oldReadyCallback.apply) {
                            oldReadyCallback.apply(this, arguments);
                        }
                    };
                }

                return oldXhrSend.apply(this, [].slice.call(arguments));
            };
        };

        var overrideFetch = function (onRequestSend, afterRequestReturn) {
            if (window.fetch && typeof Promise === 'function') {
                // ensure Promise exists. If not, skip cathing request
                var oldFetch = window.fetch;
                window.fetch = function () {
                    var _this = this;
                    var args = arguments;

                    // 当 fetch 已被支持，说明也支持 Promise 了，可以放心地实用 Promise，不用考虑兼容性
                    return new Promise(function (resolve, reject) {
                        var url;
                        var requestKey;

                        if (typeof args[0] === 'string') {
                            url = args[0];
                        } else if (typeof args[0] === 'object') { // Request Object
                            url = args[0].url;
                        }

                        // when failed to get fetch url, skip report
                        if (url) {
                            // console.warn('[auto-compute-first-screen-time] no url param found in "fetch(...)"');
                            requestKey = onRequestSend(url, 'fetch').requestKey;
                        }

                        oldFetch.apply(_this, args).then(function (response) {
                            if (requestKey) {
                                afterRequestReturn(requestKey);
                            }
                            resolve(response);
                        }).catch(function (err) {
                            if (requestKey) {
                                afterRequestReturn(requestKey);
                            }
                            reject(err);
                        });
                    })
                };
            }
        };

        // overide fetch first, then xhr, because fetch could be mocked by xhr
        overrideFetch(onRequestSend, afterRequestReturn);

        overideXhr(onRequestSend, afterRequestReturn);
    }

    function mergeUserOptions(userOptions) {
        if (userOptions) {
            if (userOptions.delayReport) {
                global.options.delayReport = userOptions.delayReport;
            }

            if (userOptions.watingTimeWhenDefineStaticPage) {
                global.options.watingTimeWhenDefineStaticPage = userOptions.watingTimeWhenDefineStaticPage;
            }

            if (userOptions.onTimeFound) {
                global.options.onTimeFound = function () {
                    var _this = this;
                    var args = arguments;

                    // delay a piece of time for reporting
                    var timer = setTimeout(function () {
                        userOptions.onTimeFound.apply(_this, args);
                        clearTimeout(timer);
                    }, global.options.delayReport);
                };
            }

            var requestConfig = userOptions.request || userOptions.xhr;
            if (requestConfig) {
                if (requestConfig.limitedIn) {
                    global.options.request.limitedIn = global.options.request.limitedIn.concat(requestConfig.limitedIn);
                }
                if (requestConfig.exclude) {
                    global.options.request.exclude = global.options.request.exclude.concat(requestConfig.exclude);
                }
            }

            if (userOptions.renderTimeAfterGettingData) {
                global.options.renderTimeAfterGettingData = userOptions.renderTimeAfterGettingData;
            }

            if (userOptions.onAllXhrResolved) {
                global.options.onAllXhrResolved = userOptions.onAllXhrResolved;
            }

            if (userOptions.img) {
                if (typeof userOptions.img === 'object' && typeof userOptions.img.test === 'function') {
                    global.options.img.push(userOptions.img);
                } else {
                    console.error('[auto-compute-first-screen-time] param "img" should be type RegExp');
                }
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
