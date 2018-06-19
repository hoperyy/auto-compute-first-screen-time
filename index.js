/**
 * @description auto compute first screen time of one page with inaccuracy less than 200ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

// for debug
// window.fetch = null;

// 复写 fetch
// require('./rewriteFetch');

// 扩展 MutationObserver 的兼容性
require('mutationobserver-shim');

var win = window;
var doc = win.document;

var timeRunner = _generateTimeRunner();

var MutationObserver = win.MutationObserver;

// dom 变化监听器
var mutationObserver = null;

// 是否已经上报的标志
var hasReported = false;

// 是否抓取过请求的标志位
var isFirstRequestSent = false;

// 记录 Mutation 回调时的 dom 信息
var domUpdateList = [];

// 可以抓取请求的时间窗口队列
var catchRequestTimeSections = [];

// 记录图片加载完成的时刻（唯一）
var imgDowloadTimeMap = {};

// 用于记录两次 mutationObserver 回调触发的时间间隔
var lastDomUpdateTime;

var requestDetails = {};

// 一些可配置项，下面是默认值
var _options = {
    onTimeFound: function (/* result */) {
        // result.finishedTime: 首屏完成的时刻
        // result.lastedTime: result.finishedTime - window.performance.timing.navigationStart 首屏持续的时间
        // result.maxErrorTime: targetInfo.blankTime // 最大误差值
    },
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
};

function _parseUrl(url) {
    var anchor = document.createElement('a');
    anchor.href = url;
    return anchor;
}

function _getMatchedTimeInfo(domUpdateList) {
    // 倒序
    domUpdateList.sort(function (a, b) {
        if (a.time < b.time) {
            return 1;
        } else {
            return -1;
        }
    });

    // 获取当前时刻的 dom 信息，作为基准值
    var finalImages = domUpdateList[0].images;

    var targetInfo;

    var isBiggerArray = function (bigArr, smallArr, testIndex) {
        for (var i = 0, len = smallArr.length; i < len; i++) {
            if (bigArr.indexOf(smallArr[i]) === -1) {
                return false;
            }
        }
        return true;
    };

    if (finalImages.length > 0) {
        for (var i = 1, len = domUpdateList.length; i < len; i++) {
            var item = domUpdateList[i];

            // 如果最终状态的首屏有图片，则通过比较首屏图片数量来确定是否首屏加载完毕；否则直接使用最后一次渲染时的 dom（默认）
            if (!isBiggerArray(item.images, finalImages, i)) {
                break;
            }
        }

        i--;

        // i === 0 说明没有匹配的
        targetInfo = domUpdateList[i];
    } else {
        for (var i = 1, len = domUpdateList.length; i < len; i++) {
            var item = domUpdateList[i];

            // 如果稳定状态没有图片，选取最近一次 dom 变化的时刻为最终时刻
            if (!item.isFromInternal) {
                break;
            }
        }

        targetInfo = domUpdateList[i];
    }

    return targetInfo;
}

function _getLastImgDownloadTime(images) {
    var timeArr = [];

    images.forEach(function (src) {
        timeArr.push(imgDowloadTimeMap[src]);
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

// 记录运行该方法时刻的 dom 信息，主要是 images；运行时机为每次 mutationObserver 回调触发或定时器触发
function _recordDomInfo(param) {
    var nowTime = new Date().getTime();
    var images = _getImagesInFirstScreen();
    var obj = {
        isFromInternal: (param && param.isInterval) ? true : false,
        isTargetTime: false,
        images: images,
        blankTime: new Date().getTime() - lastDomUpdateTime || new Date().getTime(), // 距离上次记录有多久（用于调试）
        finishedTime: -1, // 当前时刻下，所有图片加载完毕的时刻
        time: nowTime // 当前时刻
    };

    var imgIndex = 0;
    var afterDownload = function (src) {
        imgIndex++;

        if (imgIndex === images.length) {
            // 获取所有图片中加载时间最迟的时刻，作为 finishedTime
            obj.finishedTime = _getLastImgDownloadTime(images);

            // 如果图片加载完成时，发现该时刻就是目标时刻，则执行上报
            if (obj.isTargetTime) {
                // 回调
                var firstScreenTime = obj.finishedTime - window.performance.timing.navigationStart;
                _options.onTimeFound({
                    lastedTime: firstScreenTime, // old api
                    firstScreenTime: firstScreenTime, // new api
                    finishedTime: obj.finishedTime,
                    maxErrorTime: obj.blankTime, // 最大误差值

                    xhrList: requestDetails, // old api
                    requestDetails: requestDetails, // new api
                    domUpdateList: domUpdateList
                });
            }
        }
    };

    images.forEach(function (src) {
        if (imgDowloadTimeMap[src]) {
            afterDownload(src);
        } else {
            var img = new Image();
            img.src = src;

            if (img.complete) {
                // 记录该图片加载完成的时间，以最早那次为准
                if (!imgDowloadTimeMap[src]) {
                    imgDowloadTimeMap[src] = new Date().getTime();
                }
                afterDownload(src);
            } else {
                img.onload = img.onerror = function () {
                    // 记录该图片加载完成的时间，以最早那次为准
                    if (!imgDowloadTimeMap[src]) {
                        imgDowloadTimeMap[src] = new Date().getTime();
                    }
                    afterDownload(src);
                };
            }
        }
    });

    // 如果没有图片，则以当前 DOM change 的时间为准
    if (images.length === 0) {
        obj.finishedTime = nowTime;
    }

    domUpdateList.push(obj);

    lastDomUpdateTime = new Date().getTime();
}

function _generateTimeRunner() {
    var timer = null;
    var shouldBreak = false;

    function clearInterval() {
        clearTimeout(timer);
        shouldBreak = true;
    }

    function setInterval(callback, delay) {
        shouldBreak = false;
        var startTime = new Date().getTime();
        var count = 0;
        var handler = function () {
            clearTimeout(timer);

            count++;
            var offset = new Date().getTime() - (startTime + count * delay);
            var nextTime = delay - offset;
            if (nextTime < 0) {
                nextTime = 0;
            }

            callback();

            if (shouldBreak) {
                return;
            }

            timer = setTimeout(handler, nextTime);
        };
        timer = setTimeout(handler, delay);

        return timer;
    }

    return {
        setInterval: setInterval,
        clearInterval: clearInterval
    };
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
    var screenWidth = document.body.clientWidth;

    var imgList = [];

    _queryImages(function (currentNode) {
        // 过滤函数，如果符合要求，返回 true

        var boundingClientRect = currentNode.getBoundingClientRect();

        // 如果已不显示
        if (!boundingClientRect.top && !boundingClientRect.bottom) {
            return false;
        }

        var topToView = boundingClientRect.top; // getBoundingClientRect 会引起重绘
        var scrollTop = doc.body.scrollTop;

        // 如果在首屏
        if ((scrollTop + topToView) <= screenHeight) {
            if (boundingClientRect.x + boundingClientRect.width >= 0 && boundingClientRect.x <= screenWidth) {
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

function _processOnStableTimeFound() {
    if (hasReported) {
        return;
    }

    hasReported = true;
    mutationObserver.disconnect();
    timeRunner.clearInterval();

    // 记录当前时刻
    _recordDomInfo();

    // 找到离稳定状态最近的渲染变动时刻
    var targetInfo = _getMatchedTimeInfo(domUpdateList);

    if (!targetInfo) {
        console.log('[auto-compute-first-screen-time] no suitable time found.');
        return;
    }

    // 触发事件：所有异步请求已经发布完毕
    _options.onAllXhrResolved && _options.onAllXhrResolved(targetInfo.time);

    // 标记该变动时刻为目标时刻
    targetInfo.isTargetTime = true;

    // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
    if (targetInfo.finishedTime !== -1) {
        var firstScreenTime = targetInfo.finishedTime - window.performance.timing.navigationStart;
        _options.onTimeFound({
            lastedTime: firstScreenTime, // old api
            firstScreenTime: firstScreenTime, // new api
            finishedTime: targetInfo.finishedTime,
            maxErrorTime: targetInfo.blankTime, // 最大误差值

            xhrList: requestDetails,
            domUpdateList: domUpdateList
        });
    }
}

// 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
function insertTestTimeScript() {
    var insertedScript = null;
    var SCRIPT_FINISHED_FUNCTION_NAME = 'FIRST_SCREEN_SCRIPT_FINISHED_TIME_' + scriptStartTime;

    window[SCRIPT_FINISHED_FUNCTION_NAME] = function () {
        // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
        var timer = setTimeout(function() {
            if (!isFirstRequestSent) {
                _processOnStableTimeFound();
            }

            // clear
            document.body.removeChild(insertedScript);
            insertedScript = null;
            window[SCRIPT_FINISHED_FUNCTION_NAME] = null;
            clearTimeout(timer);
        }, _options.watingTimeWhenDefineStaticPage);
    };

    document.addEventListener('DOMContentLoaded', function (event) {
        insertedScript = document.createElement('script');
        insertedScript.innerHTML = 'window.' + SCRIPT_FINISHED_FUNCTION_NAME + ' && window.' + SCRIPT_FINISHED_FUNCTION_NAME + '()';
        insertedScript.async = false;
        document.body.appendChild(insertedScript);
    });
}

// 监听 dom 变化，脚本运行时就开始
function observeDomChange() {
    // 虽然定时器的间隔设置为200，但实际运行来看，间隔的时机仍然有较大误差
    var mutationIntervalDelay = 200;

    var mutationIntervalStartTime = new Date().getTime();

    var mutationIntervalCallback = function () {
        _recordDomInfo({ isInterval: true });
    };

    // 记录首屏 DOM 的变化
    mutationObserver = new MutationObserver(function () {
        _recordDomInfo();

        mutationIntervalCount = 0;
        timeRunner.clearInterval();

        // 每次浏览器检测到的 dom 变化后，启动轮询定时器，但轮询次数有上限
        mutationIntervalStartTime = new Date().getTime();
        timeRunner.setInterval(mutationIntervalCallback, mutationIntervalDelay);
    });
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 触发回调前，先记录初始时刻的 dom 信息
    _recordDomInfo();
}

function overrideRequest() {
    var requestTimerStatusPool = {};

    var isRequestDetailsEmpty = function () {
        for (var key in requestDetails) {
            if (key.indexOf('request-') !== -1 && requestDetails[key] !== 'complete') {
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
        if (hasReported) {
            shouldCatch = false;
        }

        var sendTime = new Date().getTime();

        // 如果发送数据请求的时间点在时间窗口内，则认为该抓取该请求到队列，主要抓取串联型请求
        for (var sectionIndex = 0; sectionIndex < catchRequestTimeSections.length; sectionIndex++) {
            var poolItem = catchRequestTimeSections[sectionIndex];
            if (sendTime >= poolItem[0] && sendTime <= poolItem[1]) {
                break;
            }
        }
        if (catchRequestTimeSections.length && sectionIndex === catchRequestTimeSections.length) {
            shouldCatch = false;
        }

        // 如果发送请求地址不符合白名单和黑名单规则。则认为不该抓取该请求到队列
        for (var i = 0, len = _options.request.limitedIn.length; i < len; i++) {
            if (!_options.request.limitedIn[i].test(url)) {
                shouldCatch = false;
            }
        }

        for (var i = 0, len = _options.request.exclude.length; i < len; i++) {
            if (_options.request.exclude[i].test(url)) {
                shouldCatch = false;
            }
        }

        return shouldCatch;
    }

    var onRequestSend = function(url, type) {
        if (!isFirstRequestSent) {
            isFirstRequestSent = true;
        }

        var requestKey = type + '-request-' + url + '-' + new Date().getTime();
        requestDetails[requestKey] = 'sent';
        requestTimerStatusPool[requestKey] = 'start';

        return {
            requestKey: requestKey
        }
    };

    var afterRequestReturn = function (requestKey) {
        // 标记这个请求完成
        requestDetails[requestKey] = 'complete';

        //  当前时刻
        var returnTime = new Date().getTime();
        // 从这个请求返回的时刻起，在较短的时间段内的请求也需要被监听
        catchRequestTimeSections.push([returnTime, returnTime + _options.renderTimeAfterGettingData]);

        var timer = setTimeout(function () {
            requestTimerStatusPool[requestKey] = 'stopped';
            if (isRequestDetailsEmpty() && isRequestTimerPoolEmpty()) {
                _processOnStableTimeFound();
            }
            clearTimeout(timer);
        }, _options.renderTimeAfterGettingData);
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
            _options.delayReport = userOptions.delayReport;
        }

        if (userOptions.watingTimeWhenDefineStaticPage) {
            _options.watingTimeWhenDefineStaticPage = userOptions.watingTimeWhenDefineStaticPage;
        }

        if (userOptions.onTimeFound) {
            _options.onTimeFound = function () {
                var _this = this;
                var args = arguments;

                // delay a piece of time for reporting
                var timer = setTimeout(function() {
                    userOptions.onTimeFound.apply(_this, args);
                    clearTimeout(timer);
                }, _options.delayReport);
            };
        }

        var requestConfig = userOptions.request || userOptions.xhr;
        if (requestConfig) {
            if (requestConfig.limitedIn) {
                _options.request.limitedIn = _options.request.limitedIn.concat(requestConfig.limitedIn);
            }
            if (requestConfig.exclude) {
                _options.request.exclude = _options.request.exclude.concat(requestConfig.exclude);
            }
        }

        if (userOptions.renderTimeAfterGettingData) {
            _options.renderTimeAfterGettingData = userOptions.renderTimeAfterGettingData;
        }

        if (userOptions.onAllXhrResolved) {
            _options.onAllXhrResolved = userOptions.onAllXhrResolved;
        }
    }
}

module.exports = function (userOptions) {
    mergeUserOptions(userOptions);
    insertTestTimeScript();
    observeDomChange();
    overrideRequest();
};
