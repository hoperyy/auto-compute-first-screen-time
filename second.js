// 降级算法，该算法消耗一部分的性能，用于不支持 performance API 的场景，依赖 window.performance.timing

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

// 扩展 MutationObserver 的兼容性
require('mutationobserver-shim');

var win = window;
var doc = win.document;

var globalIntervalDotTimer = null;

var MutationObserver = win.MutationObserver;

// dom 变化监听器
var mutationObserver = null;

// 是否已经停止监听的标志
var globalHasStoppedObserve = false;

var globalHasReported = false;

// 是否抓取过请求的标志位
var globalIsFirstRequestSent = false;

// 记录 Mutation 回调时的 dom 信息
var globalDotList = [];

// 可以抓取请求的时间窗口队列
var globalCatchRequestTimeSections = [];

var globalDelayAll = 0;

// 记录图片加载完成的时刻（唯一）
var globalImgMap = {};

var NAV_START_TIME = window.performance.timing.navigationStart;

// 用于记录两次 mutationObserver 回调触发的时间间隔
var globalLastDomUpdateTime = scriptStartTime;

var globalRequestDetails = {};

// 一些可配置项，下面是默认值
var globalOptions = {
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
};

function _getTime() {
    return new Date().getTime();
}

function _parseUrl(url) {
    var anchor = document.createElement('a');
    anchor.href = url;
    return anchor;
}

function _getTargetDotObj() {
    // 倒序
    globalDotList.sort(function (a, b) {
        if (a.timeStamp < b.timeStamp) {
            return 1;
        } else {
            return -1;
        }
    });

    var dotList = globalDotList.slice(1);

    // 获取当前时刻的 dom 信息，作为基准值
    var finalImages = globalDotList[0].firstScreenImages;

    var targetInfo;

    var isBiggerArray = function (bigArr, smallArr) {
        for (var i = 0, len = smallArr.length; i < len; i++) {
            if (bigArr.indexOf(smallArr[i]) === -1) {
                return false;
            }
        }
        return true;
    };

    // 如果最终状态的首屏有图片，则通过比较首屏图片数量来确定是否首屏加载完毕；否则直接使用最后一次渲染时的 dom（默认）
    if (finalImages.length > 0) {
        for (var i = 0, len = dotList.length; i < len; i++) {
            var item = dotList[i];
            if (isBiggerArray(item.firstScreenImages, finalImages)) {
                targetInfo = dotList[i];
            }
        }
    } else {
        for (var i = 0, len = dotList.length; i < len; i++) {
            var item = dotList[i];

            // 如果稳定状态没有图片，选取最近一次 dom 变化的时刻为最终时刻
            if (!item.isFromInternal) {
                targetInfo = dotList[i];
                break;
            }
        }
    }

    return targetInfo;
}

function _getLastImgDownloadTime(images) {
    var timeArr = [];

    images.forEach(function (src) {
        timeArr.push(globalImgMap[src].onloadTimeStamp);
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

function runOnTargetDotFound(targetObj) {
    if (globalHasReported) {
        return;
    }

    globalHasReported = true;

    // 为 globalImgMap 添加是否是首屏标志
    var targetFirstScreenImages = null;
    var firstScreenImgDetails = {};
    var i;
    var len;

    for (i = 0, len = globalDotList.length; i < len; i++) {
        if (globalDotList[i].isTargetDot) {
            targetFirstScreenImages = globalDotList[i].firstScreenImages;
            break;
        }
    }

    if (targetFirstScreenImages) {
        for (i = 0, len = targetFirstScreenImages.length; i < len; i++) {
            var src = targetFirstScreenImages[i];
            if (globalImgMap[src]) {
                firstScreenImgDetails[src] = globalImgMap[src];
            }
        }
    }

    // 计算性能监控计算的耗时
    var delayFirstScreen = 0;
    for (i = 0, len = globalDotList.length; i < len; i++) {
        if (globalDotList[i].duration) {
            if (globalDotList[i].timeStamp <= targetObj.timeStamp) {
                delayFirstScreen += globalDotList[i].duration;
            }
        }
    }

    globalOptions.onTimeFound({
        firstScreenTime: targetObj.finishedTimeStamp - NAV_START_TIME, // new api
        firstScreenTimeStamp: targetObj.finishedTimeStamp,
        maxErrorTime: targetObj.blankTime, // 最大误差值
        requestDetails: globalRequestDetails, // new api
        dotList: globalDotList,
        firstScreenImgDetails: firstScreenImgDetails,
        delayAll: globalDelayAll,
        delayFirstScreen: delayFirstScreen,
        type: 'dot'
    });
}

// 记录运行该方法时刻的 dom 信息，主要是 images；运行时机为每次 mutationObserver 回调触发或定时器触发
function _recordDomInfo(param) {
    var lastDot = param && param.lastDot;

    // 如果性能监控打点引发的渲染 delay 超过了 0.5s，则停止性能监控打点
    if (!lastDot && globalDelayAll >= globalOptions.abortTimeWhenDelay) {
        return;
    }

    var recordStartTime = _getTime();
    
    var firstScreenImages = _getImages({ searchInFirstScreen: lastDot });

    var recordEndTime = _getTime();

    globalDelayAll += recordEndTime - recordStartTime;

    var obj = {
        isImgInFirstScreen: lastDot,
        isFromInternal: (param && param.isFromInternal) ? true : false,
        isTargetDot: (param && param.isTargetDot) || false,
        firstScreenImages: firstScreenImages,
        firstScreenImagesLength: firstScreenImages.length,
        blankTime: _getTime() - globalLastDomUpdateTime || _getTime(), // 距离上次记录有多久（用于调试）
        finishedTimeStamp: -1, // 当前时刻下，所有图片加载完毕的时刻
        timeStamp: recordStartTime, // 当前时刻
        duration: recordEndTime - recordStartTime,
    };

    globalDotList.push(obj);

    globalLastDomUpdateTime = recordEndTime;

    // 如果没有图片，则以当前 DOM change 的时间为准
    if (!firstScreenImages.length) {
        obj.finishedTimeStamp = recordStartTime;
    } else {
        var imgIndex = 0;
        var afterDownload = function (src) {
            imgIndex++;

            if (imgIndex === firstScreenImages.length) {
                // 获取所有图片中加载时间最迟的时刻，作为 finishedTimeStamp
                obj.finishedTimeStamp = _getLastImgDownloadTime(firstScreenImages);

                // 如果图片加载完成时，发现该时刻就是目标打点对象时刻，则执行上报
                if (obj.isTargetDot) {
                    runOnTargetDotFound(obj);
                }
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
            if (globalImgMap[src]) {
                afterDownload(src);
            } else {
                var img = new Image();
                img.src = src;

                if (img.complete) {
                    // 记录该图片加载完成的时间，以最早那次为准
                    if (!globalImgMap[src]) {
                        globalImgMap[src] = generateGlobalImgMapResult();
                    }
                    afterDownload(src);
                } else {
                    img.onload = img.onerror = function () {
                        // 记录该图片加载完成的时间，以最早那次为准
                        if (!globalImgMap[src]) {
                            globalImgMap[src] = generateGlobalImgMapResult();
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

            var topToView = boundingClientRect.top; // getBoundingClientRect 会引起重绘
            var scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;

            // 如果在结构上的首屏内
            if ((scrollTop + topToView) <= screenHeight) {
                if (boundingClientRect.right >= 0 && boundingClientRect.left <= screenWidth) {
                    return true;
                }
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

function _processOnStopObserve() {
    if (globalHasStoppedObserve) {
        return;
    }
    globalHasStoppedObserve = true;

    mutationObserver.disconnect();
    clearInterval(globalIntervalDotTimer);

    // 记录当前时刻 dom 信息，且当前时刻为首屏图片数量等稳定的时刻
    _recordDomInfo({
        lastDot: true
    });

    // 向前递推，找到离稳定状态最近的渲染变动时刻
    var targetDotObj = _getTargetDotObj(globalDotList);

    if (!targetDotObj) {
        console.log('[auto-compute-first-screen-time] no suitable time found.');
        globalOptions.onTimeFound({
            firstScreenTime: -1, // new api
            firstScreenTimeStamp: -1,
            maxErrorTime: -1, // 最大误差值
            requestDetails: globalRequestDetails, // new api
            dotList: globalDotList,
            firstScreenImgDetails: _getImages({ searchInFirstScreen: true }),
            delayAll: globalDelayAll,
            delayFirstScreen: -1,
            type: 'dot'
        });
        return;
    }

    // 标记该变动时刻为目标时刻
    targetDotObj.isTargetDot = true;

    // 触发事件：所有异步请求已经发布完毕
    globalOptions.onAllXhrResolved && globalOptions.onAllXhrResolved(targetDotObj.timeStamp);

    // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
    if (targetDotObj.finishedTimeStamp !== -1) {
        runOnTargetDotFound(targetDotObj);
    }
}

// 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
function insertTestTimeScript() {
    window.addEventListener('load', function () {
        // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
        var timer = setTimeout(function () {
            // clear
            clearTimeout(timer);

            console.log('延时判断是否是静态页面：', !globalIsFirstRequestSent);
            if (!globalIsFirstRequestSent) {
                _processOnStopObserve();
            }
        }, globalOptions.watingTimeWhenDefineStaticPage);
    });
}

// 监听 dom 变化，脚本运行时就开始
function observeDomChange() {
    var lastObserverRunTime;

    var dotCallback = function (param) {
        var now = _getTime();
        if (lastObserverRunTime && now - lastObserverRunTime < globalOptions.dotDelay) {
            return;
        }

        lastObserverRunTime = now;

        _recordDomInfo(param);
    };

    // 记录首屏 DOM 的变化
    globalIntervalDotTimer = setInterval(function () {
        dotCallback({ isFromInternal: true });
    }, globalOptions.dotDelay);

    mutationObserver = new MutationObserver(function () {
        dotCallback({ mutation: true });
    });
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 触发回调前，先记录初始时刻的 dom 信息
    dotCallback();
}

function overrideRequest() {
    var requestTimerStatusPool = {};

    var isRequestDetailsEmpty = function () {
        for (var key in globalRequestDetails) {
            if (globalRequestDetails[key] && globalRequestDetails[key].status !== 'complete') {
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
        if (globalHasStoppedObserve) {
            shouldCatch = false;
        }

        var sendTime = _getTime();

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

        var requestKey = url + '>time:' + _getTime();
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
        var returnTime = _getTime();

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
                _processOnStopObserve();
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
    }
}

module.exports = function (userOptions) {
    mergeUserOptions(userOptions);
    insertTestTimeScript();
    observeDomChange();
    overrideRequest();
};

module.exports.report = function (userOptions) {
    mergeUserOptions(userOptions);
    _recordDomInfo({
        isTargetDot: true,
        lastDot: true
    });
};
