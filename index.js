/**
 * @description 自动计算首屏，和手动埋点相比，误差在 200ms 以内
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

// 脚本开始运行的时间，用于各种 log 等
var scriptStartTime = new Date().getTime();

// 扩展 MutationObserver 的兼容性
require('mutationobserver-shim');

var win = window;
var doc = win.document;

var timeRunner = genTimeRunner();

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

var xhrStatusPool = {};

// 一些可配置项，下面是默认值
var _options = {
    onTimeFound: function (/* result */) {
        // result.finishedTime: 首屏完成的时刻
        // result.lastedTime: result.finishedTime - window.performance.timing.navigationStart 首屏持续的时间
        // result.maxErrorTime: targetInfo.blankTime // 最大误差值
    },
    xhr: {
        limitedIn: [],
        exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
    },

    // 从第一个 XHR 请求发出，到可以认为所有影响首屏的数据请求都已发出的时间段
    firstScreenXhrLastedTime: 1000,

    // 获取数据后，认为渲染 dom 的时长
    renderTimeAfterGettingData: 300
};

function parseUrl(url) {
    var anchor = document.createElement('a');
    anchor.href = url;
    return anchor;
}

function getMatchedTimeInfo(domUpdatePool) {
    // 倒序
    domUpdatePool.sort(function (a, b) {
        if (a.time < b.time) {
            return 1;
        } else {
            return -1;
        }
    });

    // 获取当前时刻的 dom 信息，作为基准值
    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ 分界线 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
    var finalImages = domUpdatePool[0].images;

    var targetInfo;

    // console.log('finalImages 长度: ', finalImages.length, domUpdatePool);
    // console.log('最后一次变动距离稳定时刻的时间: ', domUpdatePool[0].time - domUpdatePool[1].time);

    var isBiggerArray = function (bigArr, smallArr) {
        for (var i = 0, len = smallArr.length; i < len; i++) {
            if (bigArr.indexOf(smallArr[i]) === -1) {
                return false;
            }
        }
        return true;
    };

    // 如果最近一次获取的 dom 变化和稳定状态的图片还是不符合，并且间隔超过了 300ms，则不执行上报
    // if (domUpdatePool[0].blankTime >= 250 && !isBiggerArray(domUpdatePool[1].images, finalImages)) {
    //     return null;
    // }

    // 从最近的一次 dom 变化开始对比
    for (var i = 1, len = domUpdatePool.length; i < len; i++) {
        var item = domUpdatePool[i];

        // 如果最终状态的首屏有图片，则通过比较首屏图片数量来确定是否首屏加载完毕；否则直接使用最后一次渲染时的 dom（默认）
        if (finalImages.length > 0) {
            if (!isBiggerArray(item.images, finalImages)) {
                break;
            }
        }
    }

    i--;

    // i === 0 说明没有匹配的
    targetInfo = domUpdatePool[i];

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

function getLastImgDownloadTime(images) {
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
}

function recordDomInfo(param) {
    // 记录当前时刻的 DOM 信息
    var nowTime = new Date().getTime();
    var images = getImagesInFirstScreen();
    // var images = getImagesInFullPage();
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
            obj.finishedTime = getLastImgDownloadTime(images);

            // 如果图片加载完成时，发现该时刻就是目标时刻，则执行上报
            if (obj.isTargetTime) {
                // 回调
                _options.onTimeFound({
                    lastedTime: obj.finishedTime - window.performance.timing.navigationStart,
                    finishedTime: obj.finishedTime,
                    maxErrorTime: obj.blankTime, // 最大误差值

                    xhrList: xhrStatusPool,
                    domUpdatePool: domUpdatePool
                });
            }
        }
    };

    images.forEach(function (src) {
        if (imgDowloadTimePool[src]) {
            afterDownload(src);
        } else {
            var img = new Image();
            img.src = src;

            if (img.complete) {
                // 记录该图片加载完成的时间，以最早那次为准
                if (!imgDowloadTimePool[src]) {
                    imgDowloadTimePool[src] = new Date().getTime();
                }
                afterDownload(src);
            } else {
                img.onload = img.onerror = function () {
                    // 记录该图片加载完成的时间，以最早那次为准
                    if (!imgDowloadTimePool[src]) {
                        imgDowloadTimePool[src] = new Date().getTime();
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

    domUpdatePool.push(obj);

    lastDomUpdateTime = new Date().getTime();
}

function genTimeRunner() {
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

            // console.log('修正时间：', nextTime);

            timer = setTimeout(handler, nextTime);
            // console.log(new Date().getTime() - (startTime + count * delay));
        };
        timer = setTimeout(handler, delay);

        return timer;
    }

    return {
        setInterval: setInterval,
        clearInterval: clearInterval
    };
}

function observeDomChange() {
    // 虽然定时器的间隔设置为200，但实际运行来看，间隔的时机仍然有较大误差
    var mutationIntervalDelay = 200;

    // 一次轮询任务持续的最长时间
    var maxQueryTime = 3000;

    // var timeDot = new Date().getTime();

    var mutationIntervalStartTime = new Date().getTime();

    var mutationIntervalCallback = function () {
        recordDomInfo({ isInterval: true });

        // console.log('定时器回调执行时刻：', new Date().getTime() - timeDot, timeDot);

        // console.log('本次轮询持续的时间：', new Date().getTime() - mutationIntervalStartTime);

        // if (new Date().getTime() - mutationIntervalStartTime >= maxQueryTime) {
        //     // 清除定时器
        //     timeRunner.clearInterval();
        // }
    };

    // 记录首屏 DOM 的变化
    mutationObserver = new MutationObserver(function () {
        recordDomInfo();

        // timeDot = new Date().getTime();

        // console.log('Mutation change', timeDot);

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
    recordDomInfo();
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

        var protocol = parseUrl(src).protocol;
        if (src && protocol && protocol.indexOf('http') === 0) {
            success(src);
        }

        currentNode = nodeIterator.nextNode();
    }
}

function getImagesInFirstScreen() {
    var screenHeight = win.innerHeight;

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

        // console.log('auto: ', currentNode, boundingClientRect);

        // 如果在首屏
        if ((scrollTop + topToView) <= screenHeight) {
            return true;
        }
    }, function (src) {
        imgList.push(src);
    });

    return imgList;
}

function getImagesInFullPage() {
    var imgList = [];

    _queryImages(function () { }, function (src) {
        imgList.push(src);
    });

    return imgList;
}

function handlerAfterStableTimeFound() {
    if (hasReported) {
        return;
    }

    hasReported = true;
    mutationObserver.disconnect();
    timeRunner.clearInterval();

    // 记录当前时刻
    recordDomInfo();

    // 找到离稳定状态最近的渲染变动时刻
    var targetInfo = getMatchedTimeInfo(domUpdatePool);

    if (!targetInfo) {
        console.log('没有找到合适的上报点，不再上报');
        return;
    }

    // 标记该变动时刻为目标时刻
    targetInfo.isTargetTime = true;

    // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
    if (targetInfo.finishedTime !== -1) {
        _options.onTimeFound({
            lastedTime: targetInfo.finishedTime - window.performance.timing.navigationStart,
            finishedTime: targetInfo.finishedTime,
            maxErrorTime: targetInfo.blankTime, // 最大误差值

            xhrList: xhrStatusPool,
            domUpdatePool: domUpdatePool
        });
    }
}

function overrideXhr() {
    var xhrTimerStatusPool = {};

    var XhrProto = XMLHttpRequest.prototype;
    XhrProto.testFirstScreenSend = XhrProto.send;

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
        var sendTime = new Date().getTime();
        var poolName = 'request-' + this._http.url + '-' + sendTime;
        xhrStatusPool[poolName] = 'sent';
        xhrTimerStatusPool[poolName] = 'start';

        var oldReadyCallback = this.onreadystatechange;
        this.onreadystatechange = function () {
            if (this.readyState === 4) {
                // 标记这个请求完成
                xhrStatusPool[poolName] = 'complete';

                //  当前时刻
                var returnTime = new Date().getTime();
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

        var sendTime = new Date().getTime();

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

        return XhrProto.testFirstScreenSend.apply(this, [].slice.call(arguments));
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
