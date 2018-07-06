// 降级算法，该算法消耗一部分的性能，用于不支持 performance API 的场景，依赖 window.performance.timing

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

var win = window;
var doc = win.document;
var NAV_START_TIME = window.performance.timing.navigationStart;
var util = require('./util');

function generateApi() {
    var global = initGlobal();

    function initGlobal() {
        return {
            intervalDotTimer: null,

            // dom 变化监听器
            mutationObserver: null,

            // 是否已经停止监听的标志
            hasStoppedObserve: false,

            hasReported: false,

            // 是否抓取过请求的标志位
            isFirstRequestSent: false,

            // 设备信息，用于样本分析
            device: {},

            // 统计没有被计入首屏的图片有哪些，和更详细的信息
            ignoredImages: [],

            // 记录 Mutation 回调时的 dom 信息
            dotList: [],

            // 可以抓取请求的时间窗口队列
            catchRequestTimeSections: [],

            delayAll: 0,

            // 记录图片加载完成的时刻（唯一）
            imgMap: {},

            // 用于记录两次 global.mutationObserver 回调触发的时间间隔
            lastDomUpdateTime: scriptStartTime,

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

                // 打点间隔
                dotDelay: 250,

                abortTimeWhenDelay: 2000 // 监控打点会引起页面重绘，如果引发页面重绘的时间超过了该值，则不再做性能统计
            }
        };
    }

    function _getTime() {
        return new Date().getTime();
    }

    function _parseUrl(url) {
        var anchor = document.createElement('a');
        anchor.href = url;
        return anchor;
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

    function _getTargetDotObj() {
        // 倒序
        global.dotList.sort(function (a, b) {
            if (a.timeStamp < b.timeStamp) {
                return 1;
            } else {
                return -1;
            }
        });

        var dotList = global.dotList.slice(1);

        // 获取当前时刻的 dom 信息，作为基准值
        var finalImages = global.dotList[0].firstScreenImages;

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
            targetInfo = global.dotList[0];
            targetInfo.firstScreenTimeStamp = performance.timing.domComplete; // 有 bug，过早获取时该值可能为 0
            targetInfo.firstScreenTime = performance.timing.domComplete - NAV_START_TIME;
        }

        if (targetInfo) {
            targetInfo.isTargetDot = true;
        }

        return targetInfo;
    }

    function _getLastImgDownloadTime(images) {
        var timeArr = [];

        images.forEach(function (src) {
            timeArr.push(global.imgMap[src].onloadTimeStamp);
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
        if (global.hasReported) {
            return;
        }

        global.hasReported = true;

        // 为 global.imgMap 添加是否是首屏标志
        var targetFirstScreenImages = null;
        var firstScreenImages = [];
        var i;
        var len;
        var requests = [];

        for (i = 0, len = global.dotList.length; i < len; i++) {
            if (global.dotList[i].isTargetDot) {
                targetFirstScreenImages = global.dotList[i].firstScreenImages;
                break;
            }
        }

        if (targetFirstScreenImages) {
            for (i = 0, len = targetFirstScreenImages.length; i < len; i++) {
                firstScreenImages.push(targetFirstScreenImages[i].replace(/^http(s)?:/, "").replace(/^\/\//, ""));
            }
        }

        // 计算性能监控计算的耗时
        var delayFirstScreen = 0;
        for (i = 0, len = global.dotList.length; i < len; i++) {
            if (global.dotList[i].duration) {
                if (global.dotList[i].timeStamp <= targetObj.timeStamp) {
                    delayFirstScreen += global.dotList[i].duration;
                }
            }
        }

        // 规范化 requests
        for (var requestKey in global.requestDetails) {
            var parsedRequestKey = requestKey
                .split(">time")[0]
                .replace(/^http(s)?:/, "")
                .replace(/^\/\//, "");
            requests.push(parsedRequestKey);
        }

        // 最终呈现给用户的首屏信息对象
        _runOnTimeFound({
            maxErrorTime: targetObj.blankTime, // 最大误差值
            dotList: global.dotList,

            delayAll: global.delayAll,
            requests: _transRequestDetails2Arr(),
            firstScreenTime: targetObj.firstScreenTimeStamp - NAV_START_TIME,
            firstScreenTimeStamp: targetObj.firstScreenTimeStamp,
            firstScreenImages: targetObj.firstScreenImages,
            firstScreenImagesLength: targetObj.firstScreenImages.length,
            delayFirstScreen: delayFirstScreen,
            type: 'dot'
        });
    }

    // 记录运行该方法时刻的 dom 信息，主要是 images；运行时机为每次 global.mutationObserver 回调触发或定时器触发
    function recordDomInfo(param) {
        var recordFirstScreen = param && param.recordFirstScreen;

        // 如果性能监控打点引发的渲染 delay 超过了 0.5s，则停止性能监控打点
        if (!recordFirstScreen && global.delayAll >= global.options.abortTimeWhenDelay) {
            return;
        }

        var recordStartTime = _getTime();

        var firstScreenImages = _getImages({ searchInFirstScreen: recordFirstScreen });

        var recordEndTime = _getTime();

        global.delayAll += recordEndTime - recordStartTime;

        var dotObj = {
            isImgInFirstScreen: recordFirstScreen,
            isFromInternal: (param && param.isFromInternal) ? true : false,
            isTargetDot: (param && param.isTargetDot) || false, // 默认是 false, 除非手动设置是目标打点（用于手动埋点）

            firstScreenImages: firstScreenImages,
            firstScreenImagesLength: firstScreenImages.length,
            blankTime: _getTime() - global.lastDomUpdateTime || _getTime(), // 距离上次记录有多久（用于调试）
            firstScreenTimeStamp: -1, // 当前时刻下，所有图片加载完毕的时刻
            timeStamp: recordStartTime, // 当前时刻
            duration: recordEndTime - recordStartTime,
        };

        global.dotList.push(dotObj);

        global.lastDomUpdateTime = recordEndTime;

        // 如果没有图片，则以 domComplete 的时间为准（有可能值为 0）
        if (!firstScreenImages.length) {
            dotObj.firstScreenTimeStamp = performance.timing.domComplete;
            _checkTargetDot(dotObj, 'no img');
        } else {
            var imgIndex = 0;
            var afterDownload = function (src) {
                imgIndex++;

                if (imgIndex === firstScreenImages.length) {
                    // 获取所有图片中加载时间最迟的时刻，作为 firstScreenTimeStamp
                    dotObj.firstScreenTimeStamp = _getLastImgDownloadTime(firstScreenImages);

                    // 检查是否是目标打点
                    _checkTargetDot(dotObj, 'img');
                }
            };

            var generateGlobalImgMapResult = function () {
                var time = _getTime();
                return {
                    onloadTimeStamp: time,
                    onloadTime: time - NAV_START_TIME,
                }
            };

            firstScreenImages.forEach(function (src) {
                if (global.imgMap[src]) {
                    afterDownload(src);
                } else {
                    var img = new Image();
                    img.src = src;

                    if (img.complete) {
                        // 记录该图片加载完成的时间，以最早那次为准
                        if (!global.imgMap[src]) {
                            global.imgMap[src] = generateGlobalImgMapResult();
                        }
                        afterDownload(src);
                    } else {
                        img.onload = img.onerror = function () {
                            // 记录该图片加载完成的时间，以最早那次为准
                            if (!global.imgMap[src]) {
                                global.imgMap[src] = generateGlobalImgMapResult();
                            }
                            afterDownload(src);
                        };
                    }
                }
            });
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

    function _getImages(param) {
        var screenHeight = win.innerHeight;
        var screenWidth = win.innerWidth;

        var searchInFirstScreen = param && param.searchInFirstScreen;

        var imgList = [];

        _queryImages(function (currentNode) {
            if (searchInFirstScreen) {
                // 过滤函数，如果符合要求，返回 true
                var boundingClientRect = currentNode.getBoundingClientRect();

                // 如果已不显示（display: none），top 和 bottom 均为 0
                if (!boundingClientRect.top && !boundingClientRect.bottom) {
                    return false;
                }

                var top = boundingClientRect.top; // getBoundingClientRect 会引起重绘
                var left = boundingClientRect.left;
                var right = boundingClientRect.right;
                var scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;

                // 写入设备信息，用于上报（这里只会执行一次）
                global.device.screenHeight = screenHeight;
                global.device.screenWidth = screenWidth;

                // 如果在结构上的首屏内
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
            } else {
                return true;
            }
        }, function (src) {
            // 去重
            if (imgList.indexOf(src) === -1) {
                imgList.push(src);
            }
        });

        return imgList;
    }

    function _runOnTimeFound(reportObj) {
        reportObj.ignoredImages = global.ignoredImages;
        reportObj.device = global.device;

        global.options.onTimeFound(reportObj);
    }

    function onStopObserving() {
        if (global.hasStoppedObserve) {
            return;
        }
        global.hasStoppedObserve = true;

        if (global.mutationObserver) {
            global.mutationObserver.disconnect();
        }

        clearInterval(global.intervalDotTimer);

        // 记录当前时刻 dom 信息，且当前时刻为首屏图片数量等稳定的时刻
        recordDomInfo({ recordFirstScreen: true });

        // 向前递推，找到离稳定状态最近的渲染变动时刻
        var targetDotObj = _getTargetDotObj(global.dotList);

        if (!targetDotObj) {
            console.log('[auto-compute-first-screen-time] no suitable time found.');
            _runOnTimeFound({
                firstScreenTime: -1,
                firstScreenTimeStamp: -1,
                maxErrorTime: -1,
                requests: _transRequestDetails2Arr(),
                dotList: global.dotList,
                firstScreenImages: _getImages({ searchInFirstScreen: true }),
                delayAll: global.delayAll,
                delayFirstScreen: -1,
                type: 'none'
            });
            return;
        }

        // 触发事件：所有异步请求已经发布完毕
        global.options.onAllXhrResolved && global.options.onAllXhrResolved(targetDotObj.timeStamp);

        // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
        _checkTargetDot(targetDotObj, 'onStopObserving');
    }

    function _checkTargetDot(dotObj, desc) {
        if (dotObj.isTargetDot && dotObj.firstScreenTimeStamp !== -1) {
            // 轮询修正 domComplete 的值
            if (dotObj.firstScreenTimeStamp === 0) {
                util.getDomCompleteTime(function (domCompleteStamp) {
                    dotObj.firstScreenTimeStamp = domCompleteStamp;
                    _runOnTargetDotFound(dotObj);
                }, desc);
            } else {
                _runOnTargetDotFound(dotObj);
            }
        }
    }

    // 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
    function insertTestTimeScript() {
        window.addEventListener('load', function () {
            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                // clear
                clearTimeout(timer);

                if (!global.isFirstRequestSent) {
                    onStopObserving();
                }
            }, global.options.watingTimeWhenDefineStaticPage);
        });
    }

    // 监听 dom 变化，脚本运行时就开始
    function observeDomChange() {
        var lastObserverRunTime;

        var dotCallback = function (param) {
            var now = _getTime();
            if (lastObserverRunTime && now - lastObserverRunTime < global.options.dotDelay) {
                return;
            }

            lastObserverRunTime = now;

            recordDomInfo(param);
        };

        // 记录首屏 DOM 的变化
        global.intervalDotTimer = setInterval(function () {
            dotCallback({ isFromInternal: true });
        }, global.options.dotDelay);

        if (window.MutationObserver) {
            global.mutationObserver = new window.MutationObserver(function () {
                dotCallback({ mutation: true });
            });
            global.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        // 触发回调前，先记录初始时刻的 dom 信息
        dotCallback();
    }

    function overrideRequest() {
        var requestTimerStatusPool = {};

        var isRequestDetailsEmpty = function () {
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
            if (global.hasStoppedObserve) {
                shouldCatch = false;
            }

            var sendTime = _getTime();

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

            var requestKey = url + '>time:' + _getTime();
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
            var returnTime = _getTime();

            ensureRequestDetail(requestKey);

            // 标记这个请求完成
            global.requestDetails[requestKey].status = 'complete';
            global.requestDetails[requestKey].completeTimeStamp = returnTime;
            global.requestDetails[requestKey].completeTime = returnTime - NAV_START_TIME;


            // 从这个请求返回的时刻起，在较短的时间段内的请求也需要被监听
            global.catchRequestTimeSections.push([returnTime, returnTime + global.options.renderTimeAfterGettingData]);

            var timer = setTimeout(function () {
                requestTimerStatusPool[requestKey] = 'stopped';
                if (isRequestDetailsEmpty() && isRequestTimerPoolEmpty()) {
                    onStopObserving();
                }
                clearTimeout(timer);
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
        }
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
        var api = generateApi();

        api.mergeUserOptions(userOptions);
        api.insertTestTimeScript();
        api.observeDomChange();
        api.overrideRequest();
    },
    hand: function(userOptions) {
        var api = generateApi();
        
        api.mergeUserOptions(userOptions);
        api.recordDomInfo({
            isTargetDot: true,
            recordFirstScreen: true
        });
    }
};

