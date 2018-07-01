/**
 * @description auto compute first screen time of one page with inaccuracy less than 200ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

if (window.performance && window.performance.timing) {
    // 脚本开始运行的时间，用于各种 log 等
    var scriptStartTime = new Date().getTime();

    var win = window;
    var doc = win.document;

    // 是否已经上报的标志
    var globalHasReported = false;

    // 是否抓取过请求的标志位
    var globalIsFirstRequestSent = false;

    // 可以抓取请求的时间窗口队列
    var globalCatchRequestTimeSections = [];

    var NAV_START_TIME = window.performance.timing.navigationStart;

    var globalRequestDetails = {};

    // 一些可配置项，下面是默认值
    var globalOptions = {
        onTimeFound: function () { },
        request: {
            limitedIn: [],
            exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
        },

        // 获取数据后，认为渲染 dom 的时长
        renderTimeAfterGettingData: 300,

        // 找到首屏时间后，延迟上报的时间，默认为 500ms，防止页面出现需要跳转到登录导致性能数据错误的问题
        delayReport: 500,

        // 检测是否是纯静态页面（没有异步请求）时，如果所有脚本运行完还没有发现异步请求，再延时当前
        watingTimeWhenDefineStaticPage: 500,

        img: [/(\.)(png|jpg|jpeg|gif|webp)/i]
    };

    function _parseUrl(url) {
        var anchor = document.createElement('a');
        anchor.href = url;
        return anchor;
    }

    function _runOnPageStable() {
        if (globalHasReported) {
            return;
        }

        globalHasReported = true;

        _recordFirstScreenInfo();
    }

    // 重操作：记录运行该方法时刻的 dom 信息，主要是 images；运行时机为每次 mutationObserver 回调触发或定时器触发
    function _recordFirstScreenInfo() {
        var firstScreenImages = _getImagesInFirstScreen();

        // 找到最后一个图片加载完成的时刻，作为首屏时刻
        var targetObj = {
            firstScreenImages: [],
            firstScreenTime: -1,
            firstScreenTimeStamp: -1,
            requestDetails: globalRequestDetails, 
        };

        if (!firstScreenImages.length) {
            targetObj.firstScreenTime = performance.timing.firstScreen;
            targetObj.firstScreenTimeStamp = performance.timing.firstScreenLoadEnd / 1000; // performance 返回的值是微秒

            globalOptions.onTimeFound(targetObj);
        } else {
            // 轮询多次获取 performance 信息，直到 performance 信息能够展示首屏资源情况
            var timer = setInterval(function () {
                var source = performance.getEntries();
                var matchedLength = 0;

                var imgLoadTimeArr = [];
                for (var i = 0, len = source.length; i < len; i++) {
                    if (firstScreenImages.indexOf(source[i].name) !== -1) {
                        matchedLength++;
                        imgLoadTimeArr.push({
                            src: source[i].name,
                            responeEnd: source[i].responseEnd,
                            details: source[i]
                        });
                    }
                }

                // 倒序
                imgLoadTimeArr.sort(function (a, b) {
                    return b.responeEnd - a.responeEnd;
                });

                if (matchedLength === firstScreenImages.length) {
                    clearInterval(timer);

                    targetObj.firstScreenImages = firstScreenImages;
                    targetObj.firstScreenTime = imgLoadTimeArr[0].responeEnd;
                    targetObj.firstScreenTimeStamp = imgLoadTimeArr[0].responeEnd + NAV_START_TIME;

                    globalOptions.onTimeFound(targetObj);
                }
            }, 1000);   
        }
    }

    function _queryImages(isMatch, success) {
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
            if (!isMatch(currentNode)) {
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

        var imgList = [];

        _queryImages(function (currentNode) {
            // 过滤函数，如果符合要求，返回 true
            var boundingClientRect = currentNode.getBoundingClientRect();

            // 如果已不显示（display: none），top 和 bottom 均为 0
            if (!boundingClientRect.top && !boundingClientRect.bottom) {
                return false;
            }

            var topToView = boundingClientRect.top; // getBoundingClientRect 会引起重绘
            var scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;

            // 如果在结构上的首屏内
            if ((scrollTop + topToView) <= screenHeight) {
                if (boundingClientRect.right >= 0 && boundingClientRect.left <= screenWidth) {
                    return true;
                }
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
        var insertedScript = null;
        var SCRIPT_FINISHED_FUNCTION_NAME = 'FIRST_SCREEN_SCRIPT_FINISHED_TIME_' + scriptStartTime;

        window[SCRIPT_FINISHED_FUNCTION_NAME] = function () {
            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                if (!globalIsFirstRequestSent) {
                    _runOnPageStable();
                }

                // clear
                document.body.removeChild(insertedScript);
                insertedScript = null;
                window[SCRIPT_FINISHED_FUNCTION_NAME] = null;
                clearTimeout(timer);
            }, globalOptions.watingTimeWhenDefineStaticPage);
        };

        document.addEventListener('DOMContentLoaded', function (event) {
            insertedScript = document.createElement('script');
            insertedScript.innerHTML = 'window.' + SCRIPT_FINISHED_FUNCTION_NAME + ' && window.' + SCRIPT_FINISHED_FUNCTION_NAME + '()';
            insertedScript.async = false;
            document.body.appendChild(insertedScript);
        });
    }

    function overrideRequest() {
        var requestTimerStatusPool = {};

        var isRequestDetailsEmpty = function () {
            for (var key in globalRequestDetails) {
                if (key.indexOf('request-') !== -1 && globalRequestDetails[key] && globalRequestDetails[key].status !== 'complete') {
                    return false;
                }
            }

            return true;
        };

        var isRequestTimerPoolEmpty = function () {
            for (var key in requestTimerStatusPool) {
                if (key.indexOf('request-') !== -1 && requestTimerStatusPool[key] !== 'stopped') {
                    return false;
                }
            }

            return true;
        };

        var shouldCatchThisRequest = function (url) {
            // 默认抓取该请求到队列，认为其可能影响首屏
            var shouldCatch = true;

            // 如果已经上报，则不再抓取请求
            if (globalHasReported) {
                shouldCatch = false;
            }

            var sendTime = new Date().getTime();

            // 如果发送数据请求的时间点在时间窗口内，则认为该抓取该请求到队列，主要抓取串联型请求
            for (var sectionIndex = 0; sectionIndex < globalCatchRequestTimeSections.length; sectionIndex++) {
                var poolItem = globalCatchRequestTimeSections[sectionIndex];
                if (sendTime >= poolItem[0] && sendTime <= poolItem[1]) {
                    break;
                }
            }
            if (globalCatchRequestTimeSections.length && sectionIndex === globalCatchRequestTimeSections.length) {
                shouldCatch = false;
            }

            // 如果发送请求地址不符合白名单和黑名单规则。则认为不该抓取该请求到队列
            for (var i = 0, len = globalOptions.request.limitedIn.length; i < len; i++) {
                if (!globalOptions.request.limitedIn[i].test(url)) {
                    shouldCatch = false;
                }
            }

            for (var i = 0, len = globalOptions.request.exclude.length; i < len; i++) {
                if (globalOptions.request.exclude[i].test(url)) {
                    shouldCatch = false;
                }
            }

            return shouldCatch;
        }

        var ensureRequestDetail = function (requestKey) {
            if (!globalRequestDetails[requestKey]) {
                globalRequestDetails[requestKey] = {
                    status: '',
                    completeTimeStamp: '',
                    completeTime: '',
                    type: ''
                };
            }
        };

        var onRequestSend = function (url, type) {
            if (!globalIsFirstRequestSent) {
                globalIsFirstRequestSent = true;
            }

            var requestKey = url + '>time:' + new Date().getTime();
            ensureRequestDetail(requestKey);

            globalRequestDetails[requestKey].status = 'sent';
            globalRequestDetails[requestKey].type = type;

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
            globalRequestDetails[requestKey].status = 'complete';
            globalRequestDetails[requestKey].completeTimeStamp = returnTime;
            globalRequestDetails[requestKey].completeTime = returnTime - NAV_START_TIME;


            // 从这个请求返回的时刻起，在较短的时间段内的请求也需要被监听
            globalCatchRequestTimeSections.push([returnTime, returnTime + globalOptions.renderTimeAfterGettingData]);

            var timer = setTimeout(function () {
                requestTimerStatusPool[requestKey] = 'stopped';
                if (isRequestDetailsEmpty() && isRequestTimerPoolEmpty()) {
                    _runOnPageStable();
                }
                clearTimeout(timer);
            }, globalOptions.renderTimeAfterGettingData);
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
                globalOptions.delayReport = userOptions.delayReport;
            }

            if (userOptions.watingTimeWhenDefineStaticPage) {
                globalOptions.watingTimeWhenDefineStaticPage = userOptions.watingTimeWhenDefineStaticPage;
            }

            if (userOptions.onTimeFound) {
                globalOptions.onTimeFound = function () {
                    var _this = this;
                    var args = arguments;

                    // delay a piece of time for reporting
                    var timer = setTimeout(function () {
                        userOptions.onTimeFound.apply(_this, args);
                        clearTimeout(timer);
                    }, globalOptions.delayReport);
                };
            }

            var requestConfig = userOptions.request || userOptions.xhr;
            if (requestConfig) {
                if (requestConfig.limitedIn) {
                    globalOptions.request.limitedIn = globalOptions.request.limitedIn.concat(requestConfig.limitedIn);
                }
                if (requestConfig.exclude) {
                    globalOptions.request.exclude = globalOptions.request.exclude.concat(requestConfig.exclude);
                }
            }

            if (userOptions.renderTimeAfterGettingData) {
                globalOptions.renderTimeAfterGettingData = userOptions.renderTimeAfterGettingData;
            }

            if (userOptions.onAllXhrResolved) {
                globalOptions.onAllXhrResolved = userOptions.onAllXhrResolved;
            }

            if (userOptions.img) {
                if (typeof userOptions.img === 'object' && typeof userOptions.img.test === 'function') {
                    globalOptions.img.push(userOptions.img);
                } else {
                    console.error('[auto-compute-first-screen-time] param "img" should be type RegExp');
                }
            }
        }
    }

    module.exports = function (userOptions) {
        mergeUserOptions(userOptions);
        insertTestTimeScript();
        overrideRequest();
    };

    module.exports.report = function (userOptions) {
        mergeUserOptions(userOptions);
        _runOnPageStable();
    };
} else {
    module.exports = function () {};
    module.exports.report = function () {};
}
