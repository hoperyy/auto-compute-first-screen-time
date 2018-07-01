/**
 * @description auto compute first screen time of one page with inaccuracy less than 200ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

if (window.performance && window.performance.timing) {
    // 脚本开始运行的时间，用于各种 log 等
    var scriptStartTime = new Date().getTime();

    // 扩展 MutationObserver 的兼容性
    require('mutationobserver-shim');

    var win = window;
    var doc = win.document;

    var globalTimeRunner = _generateTimeRunner();

    var MutationObserver = win.MutationObserver;

    // dom 变化监听器
    var mutationObserver = null;

    // 是否已经上报的标志
    var globalHasReported = false;

    // 是否抓取过请求的标志位
    var globalIsFirstRequestSent = false;

    // 记录 Mutation 回调时的 dom 信息
    var globalDomUpdateList = [];

    // 可以抓取请求的时间窗口队列
    var globalCatchRequestTimeSections = [];

    // 记录图片加载完成的时刻（唯一）
    var globalImgMap = {};

    var NAV_START_TIME = window.performance.timing.navigationStart;

    // 用于记录两次 mutationObserver 回调触发的时间间隔
    var globalLastDomUpdateTime;

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

    function _getMatchedTimeInfo() {
        // 倒序
        globalDomUpdateList.sort(function (a, b) {
            if (a.timeStamp < b.timeStamp) {
                return 1;
            } else {
                return -1;
            }
        });

        // 获取当前时刻的 dom 信息，作为基准值
        var finalImages = globalDomUpdateList[0].firstScreenImages;

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
            for (var i = 1, len = globalDomUpdateList.length; i < len; i++) {
                var item = globalDomUpdateList[i];

                // 如果最终状态的首屏有图片，则通过比较首屏图片数量来确定是否首屏加载完毕；否则直接使用最后一次渲染时的 dom（默认）
                if (!isBiggerArray(item.firstScreenImages, finalImages, i)) {
                    break;
                }
            }

            i--;

            // i === 0 说明没有匹配的
            targetInfo = globalDomUpdateList[i];
        } else {
            for (var i = 1, len = globalDomUpdateList.length; i < len; i++) {
                var item = globalDomUpdateList[i];

                // 如果稳定状态没有图片，选取最近一次 dom 变化的时刻为最终时刻
                if (!item.isFromInternal) {
                    break;
                }
            }

            targetInfo = globalDomUpdateList[i];
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

    function runOnTimeFound(targetObj) {
        // 为 globalImgMap 添加是否是首屏标志
        var targetFirstScreenImages = null;
        var firstScreenImgMap = {};
        var i;
        var len;

        for (i = 0, len = globalDomUpdateList.length; i < len; i++) {
            if (globalDomUpdateList[i].isTargetTime) {
                targetFirstScreenImages = globalDomUpdateList[i].firstScreenImages;
                break;
            }
        }

        if (targetFirstScreenImages) {
            for (i = 0, len = targetFirstScreenImages.length; i < len; i++) {
                var src = targetFirstScreenImages[i];
                if (globalImgMap[src]) {
                    globalImgMap[src].isInFirstScreen = true;
                    firstScreenImgMap[src] = globalImgMap[src];
                }
            }
        }

        // 计算性能监控计算的耗时
        var wholeComputeDelay = 0;
        var firstScreenComputeDelay = 0;
        for (i = 0, len = globalDomUpdateList.length; i < len; i++) {
            if (globalDomUpdateList[i].duration) {
                wholeComputeDelay += globalDomUpdateList[i].duration;

                if (globalDomUpdateList[i].timeStamp <= targetObj.timeStamp) {
                    firstScreenComputeDelay += globalDomUpdateList[i].duration;
                }
            }
        }

        var firstScreenTime = targetObj.imgReadyTimeStamp - NAV_START_TIME;
        globalOptions.onTimeFound({
            firstScreenTime: firstScreenTime, // new api
            firstScreenTimeStamp: targetObj.imgReadyTimeStamp,
            maxErrorTime: targetObj.blankTime, // 最大误差值
            requestDetails: globalRequestDetails, // new api
            domUpdateList: globalDomUpdateList,
            allDottedImgMap: globalImgMap,
            firstScreenImgMap: firstScreenImgMap,
            wholeComputeDelay: wholeComputeDelay,
            firstScreenComputeDelay: firstScreenComputeDelay
        });
    }

    // 重操作：记录运行该方法时刻的 dom 信息，主要是 images；运行时机为每次 mutationObserver 回调触发或定时器触发
    function _recordCurrentInfo(param) {
        var recordStartTime = new Date().getTime();
        var firstScreenImages = [];

        var fromDom = param && param.fromDom;

        // fromDom = true;

        if (fromDom) {
            firstScreenImages = _getImagesInFirstScreen();
        } else {
            firstScreenImages = _getImagesFromPageTiming();
        }

        var testImgs = _getImagesInFirstScreen();
        console.log('~~~', firstScreenImages.length, fromDom, testImgs.length);

        for (var testIndex = 0, testLen = testImgs.length; testIndex < testLen; testIndex++) {
            var testImg = new Image();
            testImg.src = testImgs[testIndex];

            console.log('status: ', testImg.complete, testImgs[testIndex]);
        }

        var obj = {
            isFromInternal: (param && param.isInterval) ? true : false,
            isTargetTime: false,
            firstScreenImages: firstScreenImages,
            firstScreenImagesLength: firstScreenImages.length,
            blankTime: new Date().getTime() - globalLastDomUpdateTime || new Date().getTime(), // 距离上次记录有多久（用于调试）
            imgReadyTimeStamp: -1, // 当前时刻下，所有图片加载完毕的时刻
            timeStamp: recordStartTime, // 当前时刻
            duration: 0,
            isFromPerformance: !fromDom // 是否通过 performance 获取
        };

        var imgIndex = 0;
        var afterDownload = function (src) {
            imgIndex++;

            if (imgIndex === firstScreenImages.length) {
                // 获取所有图片中加载时间最迟的时刻，作为 imgReadyTimeStamp
                obj.imgReadyTimeStamp = _getLastImgDownloadTime(firstScreenImages);

                // 强制上报，用于对外 api: report
                if (param && param.forceReport) {
                    obj.isTargetTime = true;
                }

                // 如果图片加载完成时，发现该时刻就是目标时刻，则执行上报
                if (obj.isTargetTime) {
                    runOnTimeFound(obj);
                }
            }
        };

        var generateGlobalImgMapResult = function () {
            var time = new Date().getTime();
            return {
                onloadTimeStamp: time,
                onloadTime: time - NAV_START_TIME,
                isInFirstScreen: false
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

        // 如果没有图片，则以当前 DOM change 的时间为准
        if (firstScreenImages.length === 0) {
            obj.imgReadyTimeStamp = recordStartTime;
        }

        var recordEndTime = new Date().getTime();

        obj.duration = recordEndTime - recordStartTime;

        globalDomUpdateList.push(obj);

        globalLastDomUpdateTime = recordEndTime;
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

    function _matchImgFilter(url) {
        for (var i = 0, len = globalOptions.img.length; i < len; i++) {
            if (globalOptions.img[i].test(url)) {
                return true;
            }
        }

        return false;
    }

    function _getImagesFromPageTiming() {
        var imgList = [];

        var resources = performance.getEntries();

        var i;
        var len;
        var j;
        var lenJ;

        for (i = 0, len = resources.length; i < len; i++) {
            var url = resources[i].name;

            // 查看是否匹配 img 正则
            if (_matchImgFilter(url)) {
                imgList.push(url);
            }
        }

        return imgList;
    }

    function _processOnStableTimeFound() {
        if (globalHasReported) {
            return;
        }

        globalHasReported = true;
        mutationObserver.disconnect();
        globalTimeRunner.clearInterval();

        // 记录当前时刻
        _recordCurrentInfo({
            fromDom: true
        });

        // 找到离稳定状态最近的渲染变动时刻
        var targetInfo = _getMatchedTimeInfo(globalDomUpdateList);

        if (!targetInfo) {
            console.log('[auto-compute-first-screen-time] no suitable time found.');
            return;
        }

        // 触发事件：所有异步请求已经发布完毕
        globalOptions.onAllXhrResolved && globalOptions.onAllXhrResolved(targetInfo.timeStamp);

        // 标记该变动时刻为目标时刻
        targetInfo.isTargetTime = true;

        // 如果 target 时刻的图片已经加载完毕，则上报该信息中记录的完成时刻
        if (targetInfo.imgReadyTimeStamp !== -1) {
            runOnTimeFound(targetInfo);
        }
    }

    // 插入脚本，用于获取脚本运行完成时间，这个时间用于获取当前页面是否有异步请求发出
    function insertTestTimeScript() {
        var insertedScript = null;
        var SCRIPT_FINISHED_FUNCTION_NAME = 'FIRST_SCREEN_SCRIPT_FINISHED_TIME_' + scriptStartTime;

        window[SCRIPT_FINISHED_FUNCTION_NAME] = function () {
            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                if (!globalIsFirstRequestSent) {
                    _processOnStableTimeFound();
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

    // 监听 dom 变化，脚本运行时就开始
    function observeDomChange() {
        // 虽然定时器的间隔设置为200，但实际运行来看，间隔的时机仍然有较大误差
        var mutationIntervalDelay = 200;

        var mutationIntervalStartTime = new Date().getTime();

        var mutationIntervalCallback = function () {
            _recordCurrentInfo({ isInterval: true });
        };

        // 记录首屏 DOM 的变化
        mutationObserver = new MutationObserver(function () {
            _recordCurrentInfo();

            mutationIntervalCount = 0;
            globalTimeRunner.clearInterval();

            // 每次浏览器检测到的 dom 变化后，启动轮询定时器，但轮询次数有上限
            mutationIntervalStartTime = new Date().getTime();
            globalTimeRunner.setInterval(mutationIntervalCallback, mutationIntervalDelay);
        });
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 触发回调前，先记录初始时刻的 dom 信息
        _recordCurrentInfo();
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
                    _processOnStableTimeFound();
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
        observeDomChange();
        overrideRequest();
    };

    module.exports.report = function (userOptions) {
        mergeUserOptions(userOptions);
        _recordCurrentInfo({
            forceReport: true,
            fromDom: true
        });
    };
} else {
    module.exports = function () {};
    module.exports.report = function () {};
}
