var MutationObserver = window.MutationObserver || window.WebKitMutationObserver || window.MozMutationObserver;

module.exports = {
    version: '5.0.3',

    NAV_START_TIME: window.performance.timing.navigationStart,

    getLastDomUpdateTime: function (_global, callback) {
        // 说明 dom 发生过变化
        if (_global.domUpdateTimeStamp) {
            callback(_global.domUpdateTimeStamp);
        } else {
            // dom 没有发生过变化，这时要区别对待
            // 如果不是单页应用内部子页面跳转过，则直接取 domContentLoadedEventStart 时刻
            if (_global._isUsingOriginalNavStart) {
                var count = 0;
                var handler = function () {
                    if (performance.timing.domContentLoadedEventStart != 0) {
                        callback(performance.timing.domContentLoadedEventStart);
                    }

                    if (++count >= 10 || performance.timing.domContentLoadedEventStart != 0) {
                        clearInterval(timer);
                    }
                };
                // 轮询获取 domComplete 的值，最多轮询 10 次
                var timer = setInterval(handler, 500);

                handler();   
            } else {
                // 如果单页应用内部子页面跳转过，则直接取跳转的时刻
                callback(_global.forcedNavStartTimeStamp);
            }
        }
    },

    getImgSrcFromDom: function (dom, imgFilter) {
        var src;

        if (dom.nodeName.toUpperCase() == 'IMG') {
            src = dom.getAttribute('src');
        } else {
            var computedStyle = window.getComputedStyle(dom);
            var bgImg = computedStyle.getPropertyValue('background-image') || computedStyle.getPropertyValue('background');

            var match = bgImg.match(/url\(.+\)/);
            var str = match && match[0];
            if (str) {
                str = str.replace(/^url\([\'\"]?/, '').replace(/[\'\"]?\)$/, '');

                if ((/^http/.test(str) || /^\/\//.test(str)) && this._filteImg(str, imgFilter)) {
                    src = str;
                }
            }
        }

        return src;
    },

    _filteImg: function (src, imgFilter) {
        for (var i = 0, len = imgFilter.length; i < len; i++) {
            if (imgFilter[i].test(src)) {
                return true;
            }
        }

        return false;
    },

    currentPos: {
        scrollTop: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
    },

    recordCurrentPos: function (currentNode, _global) {
        var boundingClientRect = currentNode.getBoundingClientRect();

        var scrollWrapper = document.querySelector(_global.scrollWrapper);
        var scrollTop;

        // 优先使用加了 perf-scroll 标志的 dom 节点作为滚动容器
        if (scrollWrapper) {
            var scrollWrapperClientRect = scrollWrapper.getBoundingClientRect();

            if (scrollWrapperClientRect.top < 0) {
                scrollTop = -scrollWrapperClientRect.top;
            } else {
                scrollTop = 0;
            }
        } else {
            scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        }

        var top = boundingClientRect.top; // getBoundingClientRect 会引起重绘
        var bottom = boundingClientRect.bottom;
        var left = boundingClientRect.left;
        var right = boundingClientRect.right;

        this.currentPos.scrollTop = scrollTop;
        this.currentPos.top = top;
        this.currentPos.bottom = bottom;
        this.currentPos.left = left;
        this.currentPos.right = right;
    },

    isInFirstScreen: function (currentNode) {
        // 如果已不显示（display: none），top 和 bottom 均为 0
        if (!this.currentPos.top && !this.currentPos.bottom) {
            return false;
        }

        var screenHeight = window.innerHeight;
        var screenWidth = window.innerWidth;

        var scrollTop = this.currentPos.scrollTop;
        var top = this.currentPos.top;
        var left = this.currentPos.left;
        var right = this.currentPos.right;

        // 如果在结构上的首屏内（上下、左右）
        if ((scrollTop + top) < screenHeight && right > 0 && left < screenWidth) {
            return true;
        }

        return false;
    },
    queryAllNode: function (ignoreTag) {
        var _this = this;

        var result = document.createNodeIterator(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            function (node) {
                // 判断该元素及其父元素是否是需要忽略的元素
                if (!_this._shouldIgnoreNode(node, ignoreTag)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        return result;
    },
    _shouldIgnoreNode: function (child, ignoreTag) {
        var ignoredNodes = document.querySelectorAll(ignoreTag);

        for (var i = 0, len = ignoredNodes.length; i < len; i++) {
            if (this._isChild(child, ignoredNodes[i])) {
                return true;
            }
        }

        return false;
    },

    _isChild: function (child, parent) {
        var isChild = false;

        while (child) {
            if (child === parent) {
                isChild = true;
                break;
            }

            child = child.parentNode;
        }

        return isChild;
    },
    parseUrl: function (url) {
        var anchor = document.createElement('a');
        anchor.href = url;
        return anchor;
    },
    transRequestDetails2Arr: function (_global) {
        var requests = [];
        var requestItem = {};

        // 规范化 requests
        for (var requestDetailKey in _global.requestDetails) {
            var parsedRequestDetailKey = requestDetailKey
                .split(">time")[0]
                .replace(/^http(s)?:/, '')
                .replace(/^\/\//, '');

            requestItem = {
                src: parsedRequestDetailKey
            };

            for (var requestItemkey in _global.requestDetails[requestDetailKey]) {
                requestItem[requestItemkey] = _global.requestDetails[requestDetailKey][requestItemkey];
            }

            requests.push(requestItem);
        }

        return requests;
    },

    formateUrl: function (url) {
        return url.replace(/^http(s)?\:/, '').replace(/^\/\//, '');
    },

    initGlobal: function () {
        return {
            // 是否已经上报的标志
            stopCatchingRequest: false,

            // 是否抓取过请求的标志位
            isFirstRequestSent: false,

            // 可以抓取请求的时间窗口队列
            catchRequestTimeSections: [],

            // 统计没有被计入首屏的图片有哪些，和更详细的信息
            ignoredImages: [],

            // 设备信息，用于样本分析
            device: {},

            requestDetails: {},

            delayAll: 0,

            ignoreTag: '[perf-ignore]',

            scrollWrapper: '[perf-scroll]',

            // 记录 url 改变的历史，用于单页应用性能监控
            urlChangeStore: [],

            // 是否退出上报
            abortReport: false,

            // 描述上报类型，默认是空
            reportDesc: '',

            // 记录 dom 更新的时间
            domUpdateTimeStamp: 0,

            // 强制上报的时间，用于手动上报并且首屏没有图片的情况
            forcedReportTimeStamp: 0,

            // 计算首屏时间耗时的开始时刻，默认是 navigationStart，对于单页应用，该值有可能修改
            forcedNavStartTimeStamp: window.performance.timing.navigationStart,

            _originalNavStart: window.performance.timing.navigationStart,

            _isUsingOriginalNavStart: true,

            _perfStartChanged: false,

            onReport: function () { },

            onStableStatusFound: function () { },

            onNavigationStartChange: function () { },

            onNavigationStartChange: function() {},

            request: {
                limitedIn: [],
                exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
            },

            // 获取数据后，认为渲染 dom 的时长；同时也是串联请求的等待间隔
            renderTimeAfterGettingData: 300,

            // onload 之后延时一段时间，如果到期后仍然没有异步请求发出，则认为是纯静态页面
            watingTimeWhenDefineStaticPage: 3000,

            img: [/(\.)(png|jpg|jpeg|gif|webp)/i], // 匹配图片的正则表达式

            // 监听 body 标签上的 perf-start 变化，如果设置为 true，那么，每次 perf-start 变化均触发首屏时间的自动计算。主要用于单页应用计算首屏
            watchPerfStartChange: false,
        }
    },

    getTime: function () {
        return new Date().getTime();
    },

    mergeGlobal: function (defaultGlobal, privateGlobal) {
        var key;
        for (key in privateGlobal) {
            defaultGlobal[key] = privateGlobal[key];
        }

        return defaultGlobal;
    },

    overrideFetch: function (onRequestSend, afterRequestReturn) {
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
    },

    overrideRequest: function (_global, onStable) {
        var _this = this;
        var requestTimerStatusPool = {};

        var hasAllReuestReturned = function () {
            for (var key in _global.requestDetails) {
                if (_global.requestDetails[key] && _global.requestDetails[key].status !== 'complete') {
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

            if (_global.stopCatchingRequest) {
                shouldCatch = false;
            }

            var sendTime = _this.getTime();

            // 如果发送数据请求的时间点在时间窗口内，则认为该抓取该请求到队列，主要抓取串联型请求
            for (var sectionIndex = 0; sectionIndex < _global.catchRequestTimeSections.length; sectionIndex++) {
                var poolItem = _global.catchRequestTimeSections[sectionIndex];
                if (sendTime >= poolItem[0] && sendTime <= poolItem[1]) {
                    break;
                }
            }
            if (_global.catchRequestTimeSections.length && sectionIndex === _global.catchRequestTimeSections.length) {
                shouldCatch = false;
            }

            // 如果发送请求地址不符合白名单和黑名单规则。则认为不该抓取该请求到队列
            for (var i = 0, len = _global.request.limitedIn.length; i < len; i++) {
                if (!_global.request.limitedIn[i].test(url)) {
                    shouldCatch = false;
                }
            }

            for (var i = 0, len = _global.request.exclude.length; i < len; i++) {
                if (_global.request.exclude[i].test(url)) {
                    shouldCatch = false;
                }
            }

            return shouldCatch;
        }

        var ensureRequestDetail = function (requestKey) {
            if (!_global.requestDetails[requestKey]) {
                _global.requestDetails[requestKey] = {
                    status: '',
                    completeTimeStamp: '',
                    completeTime: '',
                    type: ''
                };
            }
        };

        var onRequestSend = function (url, type) {
            if (!_global.isFirstRequestSent) {
                _global.isFirstRequestSent = true;
            }

            var requestKey = url + '>time:' + _this.getTime();
            ensureRequestDetail(requestKey);

            _global.requestDetails[requestKey].status = 'sent';
            _global.requestDetails[requestKey].type = type;

            requestTimerStatusPool[requestKey] = 'start';

            return {
                requestKey: requestKey
            }
        };


        var afterRequestReturn = function (requestKey) {
            //  当前时刻
            var returnTime = _this.getTime();

            ensureRequestDetail(requestKey);

            // 标记这个请求完成
            _global.requestDetails[requestKey].status = 'complete';
            _global.requestDetails[requestKey].completeTimeStamp = returnTime;
            _global.requestDetails[requestKey].completeTime = returnTime - _this.NAV_START_TIME;

            // 从这个请求返回的时刻起，延续一段时间，该时间段内的请求也需要被监听
            _global.catchRequestTimeSections.push([returnTime, returnTime + _global.renderTimeAfterGettingData]);

            var renderDelayTimer = setTimeout(function () {
                requestTimerStatusPool[requestKey] = 'stopped';
                if (hasAllReuestReturned() && isRequestTimerPoolEmpty()) {
                    onStable();
                }
                clearTimeout(renderDelayTimer);
            }, _global.renderTimeAfterGettingData);
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

        // overide fetch first, then xhr, because fetch could be mocked by xhr
        this.overrideFetch(onRequestSend, afterRequestReturn);

        overideXhr(onRequestSend, afterRequestReturn);
    },

    mergeUserConfig: function (_global, userConfig) {
        if (userConfig) {
            for (var userConfigKey in userConfig) {
                if (['watingTimeWhenDefineStaticPage', 'onReport', 'onStableStatusFound', 'renderTimeAfterGettingData', 'onAllXhrResolved', 'onNavigationStartChange', 'onNavigationStartChange', 'watchPerfStartChange', 'forcedNavStartTimeStamp'].indexOf(userConfigKey) !== -1) {
                    _global[userConfigKey] = userConfig[userConfigKey];
                }
            }

            var requestConfig = userConfig.request || userConfig.xhr;
            if (requestConfig) {
                if (requestConfig.limitedIn) {
                    _global.request.limitedIn = _global.request.limitedIn.concat(requestConfig.limitedIn);
                }
                if (requestConfig.exclude) {
                    _global.request.exclude = _global.request.exclude.concat(requestConfig.exclude);
                }
            }

            if (userConfig.img) {
                if (typeof userConfig.img === 'object' && typeof userConfig.img.test === 'function') {
                    _global.img.push(userConfig.img);
                } else {
                    console.error('[auto-compute-first-screen-time] param "img" should be type RegExp');
                }
            }
        }

        // 不用全等，避免字符串和数字之间不相等的情况
        _global._isUsingOriginalNavStart = _global.forcedNavStartTimeStamp == _global._originalNavStart;
    },

    _appendScript: function (callback) {
        var insertedScript = null;
        var functionName = 'AUTO_COMPUTE_FIRST_SCREEN_TIME_' + this.getTime() + '_' + parseInt(Math.random() * 100);

        var insert = function () {
            insertedScript = document.createElement('script');
            insertedScript.innerHTML = 'window.' + functionName + ' && window.' + functionName + '()';
            insertedScript.async = false;
            document.body.appendChild(insertedScript);
        };

        window[functionName] = function () {
            callback();

            // 清理
            document.body.removeChild(insertedScript);
            insertedScript = null;
            window[functionName] = null;
        };

        if (window.document && window.document.createElement) {
            insert();
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                insert();
            });
        }
    },

    testStaticPage: function (onStable, _global) {
        var handler = function () {
            window.autoComputeFirstScreenTimeOnloadFinishedTag = true;

            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                clearTimeout(timer);

                if (!_global.isFirstRequestSent) {
                    onStable();
                }
            }, _global.watingTimeWhenDefineStaticPage);
        };

        if (window.autoComputeFirstScreenTimeOnloadFinishedTag) {
            handler();
        } else {
            window.addEventListener('load', handler);
        }
    },

    watchDomUpdate: function (_global) {
        if (MutationObserver) {
            _global.mutationObserver = new MutationObserver(function () {
                _global.domUpdateTimeStamp = new Date().getTime();
            });
            _global.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    },
    stopWatchDomUpdate: function (_global) {
        if (_global.mutationObserver) {
            _global.mutationObserver.disconnect();
        }
    },

    getPerfStart: function() {
        return window.parseFloat(document.body.getAttribute('perf-start'));
    },

    onNavigationStartChange: function (_global, callback) {
        if (_global.watchPerfStartChange && !window.autoComputeFirstScreenTimeWatchPerfStartChange) {
            window.autoComputeFirstScreenTimeWatchPerfStartChange = true; // 一个页面，只允许一个观察者

            var prePerfStartTimeStamp;
            var curPerfStartTimeStamp;

            var that = this;

            var hasFirstChangeHappened = false;

            var check = function () {
                curPerfStartTimeStamp = that.getPerfStart();

                // 当前值存在才可以
                if (curPerfStartTimeStamp) {
                    if (!prePerfStartTimeStamp) {
                        hasFirstChangeHappened = true;
                    } else {
                        if (curPerfStartTimeStamp !== prePerfStartTimeStamp) {
                            _global._perfStartChanged = true;
                            // 触发用户注册的回调
                            _global.onNavigationStartChange(prePerfStartTimeStamp, curPerfStartTimeStamp);
                            callback(prePerfStartTimeStamp, curPerfStartTimeStamp);
                        }
                    }
                }

                prePerfStartTimeStamp = curPerfStartTimeStamp;
            };

            if (MutationObserver) {
                var observer = new MutationObserver(function (mutations, observer) {
                    mutations.forEach(function (mutation) {
                        if (mutation.attributeName === 'perf-start') {
                            check();
                        }
                    });
                });
                observer.observe(document.body, { attributes: true });
            } else {
                setInterval(check, 250);
            }
        }
    }
};
