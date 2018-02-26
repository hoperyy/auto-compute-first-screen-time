/**
 * @description 自动计算首屏，和真实首屏时间对比，误差在 100ms 以内
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = Date.now();

// 扩展 MutationObserver 的兼容性
require('mutationobserver-shim');

var win = window;
var doc = win.document;

var MutationObserver = win.MutationObserver;

// dom 变化监听器
var mutationObserver = null;

// 是否已经上报的标志
var hasReported = false;

// 是否抓取到过 XHR 请求的标志位
var isFirstXhrSent = false;

// 记录 Mutation 回调时的 dom 信息
var domUpdatePool = [];

// 可以抓取请求的时间窗口队列
var catchXhrTimePool = [];

// 记录图片加载完成的时刻（唯一）
var imgDowloadTimePool = {};

// 用于记录两次 mutationObserver 回调触发的时间间隔
var lastDomUpdateTime;

// 一些可配置项，下面是默认值
var _options = {
    onTimeFound: function (/* result */) {
        // result.finishedTime: 首屏完成的时刻
        // result.lastedTime: result.finishedTime - window.performance.timing.navigationStart 首屏持续的时间
    },
    xhr: {
        limitedIn: [],
        exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
    },

    // 从第一个 XHR 请求发出，到可以认为所有影响首屏的数据请求都已发出的时间段
    firstScreenXhrLastedTime: 800,

    // 获取数据后，认为渲染 dom 的时长
    renderTimeAfterGettingData: 200
};

function parseUrl(url) {
    var anchor = document.createElement('a');
    anchor.href = url;
    return anchor;
}

function getMatchedTime(domUpdatePool) {
    // 倒序
    domUpdatePool.sort(function (a, b) {
        if (a.time < b.time) {
            return 1;
        } else {
            return -1;
        }
    });

    // 获取当前时刻的 dom 信息，作为基准值
    var finalImages = getImagesInFirstScreen();

    // 默认选取最近一次 dom 更新 为首屏时间
    var targetInfo = domUpdatePool[0];

    // domUpdatePool[1].images = domUpdatePool[0].images;

    // console.log(domUpdatePool, finalImages);

    var isBiggerArray = function (bigArr, smallArr) {
        for (var i = 0, len = smallArr.length; i < len; i++) {
            if (bigArr.indexOf(smallArr[i]) === -1) {
                return false;
            }
        }
        return true;
    };

    for (var i = 0, len = domUpdatePool.length; i < len; i++) {
        var item = domUpdatePool[i];

        // 如果最终状态的首屏有图片，则通过比较首屏图片数量来确定是否首屏加载完毕；否则直接使用最后一次渲染时的 dom（默认）
        if (finalImages.length > 0) {
            // 如果某个时刻可检测到的图片包含所有的最终状态图片，认为该时刻是首屏稳定状态
            if (isBiggerArray(item.images, finalImages)) {
                // console.log('倒数第：', i, ' 个渲染点');
                targetInfo = item;
            } else {
                break;
            }
        }
    }

    return targetInfo;
}

// 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
function insertTestTimeScript() {
    var insertedScript = null;
    var SCRIPT_FINISHED_FUNCTION_NAME = 'FIRST_SCREEN_SCRIPT_FINISHED_TIME_' + scriptStartTime;

    window[SCRIPT_FINISHED_FUNCTION_NAME] = function () {
        // 如果脚本运行完毕，页面还没有 XHR 请求，则尝试上报
        if (!isFirstXhrSent) {
            handlerAfterStableTimeFound();
        }

        // 清理
        document.body.removeChild(insertedScript);
        insertedScript = null;
        window[SCRIPT_FINISHED_FUNCTION_NAME] = null;
    };

    document.addEventListener('DOMContentLoaded', function (event) {
        insertedScript = document.createElement('script');
        insertedScript.innerHTML = 'window.' + SCRIPT_FINISHED_FUNCTION_NAME + ' && window.' + SCRIPT_FINISHED_FUNCTION_NAME + '()';
        insertedScript.async = false;
        document.body.appendChild(insertedScript);
    });
}

var getLastImgDownloadTime = function (images) {
    var timeArr = [];

    images.forEach(function (src) {
        timeArr.push(imgDowloadTimePool[src]);
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
};

function recordDomInfo() {
    // 记录当前时刻的 DOM 信息
    var nowTime = Date.now();
    var images = getImagesInFirstScreen();
    var obj = {
        time: nowTime, // 当前时刻
        blankTime: Date.now() - lastDomUpdateTime || Date.now(), // 距离上次记录有多久（用于调试）
        finishedTime: -1, // 当前时刻下，所有图片加载完毕的时刻
        images: images,
        isTargetTime: false
    };

    var imgIndex = 0;
    var afterDownload = function (src) {
        // 记录该图片加载完成的时间，以最早那次为准
        if (!imgDowloadTimePool[src]) {
            imgDowloadTimePool[src] = Date.now();
        }
        imgIndex++;

        if (imgIndex === images.length) {
            // 获取所有图片中加载时间最迟的时刻，作为 finishedTime
            obj.finishedTime = getLastImgDownloadTime(images);

            // 如果该时刻恰好是首屏刚刚稳定的时刻
            if (obj.isTargetTime) {
                // 回调
                _options.onTimeFound({
                    lastedTime: obj.finishedTime - window.performance.timing.navigationStart,
                    finishedTime: obj.finishedTime
                });
            }
        }
    };

    images.forEach(function (src) {
        var img = new Image();
        img.onload = img.onerror = function () {
            afterDownload(src);
        };
        img.src = src;
    });

    // 如果没有图片，则以当前 DOM change 的时间为准
    if (images.length === 0) {
        obj.finishedTime = nowTime;
    }

    domUpdatePool.push(obj);

    lastDomUpdateTime = Date.now();
}

function observeDomChange() {
    // 记录首屏 DOM 的变化
    mutationObserver = new MutationObserver(recordDomInfo);
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 触发回调前，先记录初始时刻的 dom 信息
    recordDomInfo();
}

function getImagesInFirstScreen() {
    var screenHeight = win.innerHeight;

    var nodeIterator = doc.createNodeIterator(
        doc.body,
        NodeFilter.SHOW_ELEMENT,
        function (node) {
            if (node.nodeName.toUpperCase() == 'IMG') {
                return NodeFilter.FILTER_ACCEPT;
            } else if (win.getComputedStyle(node).getPropertyValue('background-image') !== 'none') {
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    var currentNode = nodeIterator.nextNode();
    var imgList = [];
    while (currentNode) {
        if (getElementTop(currentNode) >= screenHeight) {
            currentNode = nodeIterator.nextNode();
            continue;
        }

        var src = '';
        if (currentNode.nodeName.toUpperCase() == 'IMG') {
            src = currentNode.getAttribute('src');
        } else {
            var bgImg = win.getComputedStyle(currentNode).getPropertyValue('background-image');
            var match = bgImg.match(/^url\(['"](.+\/\/.+)['"]\)$/);
            src = match && match[1];
        }

        var protocol = parseUrl(src).protocol;
        if (src && protocol && protocol.indexOf('http') === 0) {
            imgList.push(src);
        }

        currentNode = nodeIterator.nextNode();
    }

    return imgList;
};

function getElementTop(element) {
    var topToView = element.getBoundingClientRect().top,
        scrollTop = doc.body.scrollTop;

    return (scrollTop + topToView);
};

function handlerAfterStableTimeFound() {
    if (hasReported) {
        return;
    }

    hasReported = true;
    mutationObserver.disconnect();

    var targetInfo = getMatchedTime(domUpdatePool);
    targetInfo.isTargetTime = true;

    // 如果 target 时刻的图片已经加载完毕
    if (targetInfo.finishedTime !== -1) {
        _options.onTimeFound({
            lastedTime: targetInfo.finishedTime - window.performance.timing.navigationStart,
            finishedTime: targetInfo.finishedTime
        });
    }
}

function overrideXhr() {
    var xhrStatusPool = {};
    var xhrTimerStatusPool = {};

    var XhrProto = XMLHttpRequest.prototype;
    XhrProto.owlTestFirstScreenSend = XhrProto.send;

    var isXhrStatusPoolEmpty = function () {
        for (var key in xhrStatusPool) {
            if (key.indexOf('request-') !== -1 && xhrStatusPool[key] !== 'complete') {
                return false;
            }
        }

        return true;
    };

    var isXhrTimerPoolEmpty = function () {
        for (var key in xhrTimerStatusPool) {
            if (key.indexOf('request-') !== -1 && xhrTimerStatusPool[key] !== 'stopped') {
                return false;
            }
        }

        return true;
    };

    // 标志是否在获取 XHR 请求的时间区间内
    var isCatchXhrTimeout = false;
    // 如果是第一次抓取到 XHR 请求，则开始定时器，持续时间 FIRST_SCREEN_XHR_LASTED_TIME，获取在此期间内的所有 XHR 请求
    var setupCatchingXhrTimer = function () {
        var timer = setTimeout(function () {
            isCatchXhrTimeout = true;

            // 如果时间已到，并且请求池内没有未返回的请求了，说明窗口期内的请求均已返回完毕，该时刻为首屏稳定状态，执行相关函数
            if (isXhrStatusPoolEmpty() && isXhrTimerPoolEmpty()) {
                handlerAfterStableTimeFound();
            }

            clearTimeout(timer);
        }, _options.firstScreenXhrLastedTime);
    };

    var catchThisXhr = function () {
        var sendTime = Date.now();
        var poolName = 'request-' + this._http.url + '-' + sendTime;
        xhrStatusPool[poolName] = 'sent';
        xhrTimerStatusPool[poolName] = 'start';

        var oldReadyCallback = this.onreadystatechange;
        this.onreadystatechange = function () {
            if (this.readyState === 4) {
                // 标记这个请求完成
                xhrStatusPool[poolName] = 'complete';

                //  当前时刻
                var returnTime = Date.now();
                // 从这个请求返回的时刻起，在较短的时间段内的请求也需要被监听
                catchXhrTimePool.push([returnTime, returnTime + _options.renderTimeAfterGettingData]);

                var timer = setTimeout(function () {
                    xhrTimerStatusPool[poolName] = 'stopped';
                    if (isCatchXhrTimeout && isXhrStatusPoolEmpty() && isXhrTimerPoolEmpty()) {
                        handlerAfterStableTimeFound();
                    }
                    clearTimeout(timer);
                }, _options.renderTimeAfterGettingData);
            }

            oldReadyCallback.apply(this, arguments);
        };
    };

    var shouldCatchThisXhr = function (url) {
        // 默认抓取该请求到队列，认为其可能影响首屏
        var shouldCatch = true;

        // 如果已经上报，则不再抓取请求
        if (hasReported) {
            shouldCatch = false;
        }

        var sendTime = Date.now();

        // 如果发送数据请求的时间点超过了抓取数据的时间窗口，并且不在其他时间窗口内，则认为不该抓取该请求到队列
        if (isCatchXhrTimeout) {
            for (var sectionIndex = 0; sectionIndex < catchXhrTimePool.length; sectionIndex++) {
                var poolItem = catchXhrTimePool[sectionIndex];
                if (sendTime >= poolItem[0] && sendTime <= poolItem[1]) {
                    break;
                }
            }
            if (sectionIndex === catchXhrTimePool.length) {
                shouldCatch = false;
            }
        }

        // 如果发送请求地址不符合白名单和黑名单规则。则认为不该抓取该请求到队列
        for (var i = 0, len = _options.xhr.limitedIn.length; i < len; i++) {
            if (!_options.xhr.limitedIn[i].test(url)) {
                shouldCatch = false;
            }
        }

        for (var i = 0, len = _options.xhr.exclude.length; i < len; i++) {
            if (_options.xhr.exclude[i].test(url)) {
                shouldCatch = false;
            }
        }

        return shouldCatch;
    }

    XhrProto.send = function () {
        if (shouldCatchThisXhr(this._http.url)) {
            if (!isFirstXhrSent) {
                isFirstXhrSent = true;
                setupCatchingXhrTimer.apply(this, arguments);
            }

            catchThisXhr.apply(this, arguments);
        }

        return XhrProto.owlTestFirstScreenSend.apply(this, [].slice.call(arguments));
    };
}

function mergeUserOptions(userOptions) {
    if (userOptions) {
        if (userOptions.onTimeFound) {
            _options.onTimeFound = function () {
                userOptions.onTimeFound.apply(this, arguments);
            };
        }

        if (userOptions.xhr) {
            if (userOptions.xhr.limitedIn) {
                _options.xhr.limitedIn = _options.xhr.limitedIn.concat(userOptions.xhr.limitedIn);
            }
            if (userOptions.xhr.exclude) {
                _options.xhr.exclude = _options.xhr.exclude.concat(userOptions.xhr.exclude);
            }
        }

        if (userOptions.firstScreenXhrLastedTime) {
            _options.firstScreenXhrLastedTime = userOptions.firstScreenXhrLastedTime;
        }

        if (userOptions.renderTimeAfterGettingData) {
            _options.renderTimeAfterGettingData = userOptions.renderTimeAfterGettingData;
        }
    }
}

module.exports = function (userOptions) {
    mergeUserOptions(userOptions);
    insertTestTimeScript();
    observeDomChange();
    overrideXhr();
};
