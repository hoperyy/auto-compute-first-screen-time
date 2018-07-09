module.exports = {
    version: '4.1.12',

    NAV_START_TIME: window.performance.timing.navigationStart,

    getDomCompleteTime: function(callback) {
        var modifyDomCompleteCount = 0;
        var handler = function () {
            if (performance.timing.domComplete != 0) {
                callback(performance.timing.domComplete);
            }

            if (++modifyDomCompleteCount >= 10 || performance.timing.domComplete != 0) {
                clearInterval(modifyDomCompleteTimer);
            }
        };
        // 轮询获取 domComplete 的值，最多轮询 10 次
        var modifyDomCompleteTimer = setInterval(handler, 500);

        handler();
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

    _filteImg: function(src, imgFilter) {
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

    recordCurrentPos: function(currentNode) {
        var boundingClientRect = currentNode.getBoundingClientRect();
        var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

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
        var top = this.currentPos.top; // getBoundingClientRect 会引起重绘
        var left = this.currentPos.left;
        var right = this.currentPos.right;

        // 如果在结构上的首屏内（上下、左右）
        if ((scrollTop + top) <= screenHeight && right >= 0 && left <= screenWidth) {
            return true;
        }

        return false;
    },
    queryAllNode: function() {
        return document.createNodeIterator(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            function (node) {
                return NodeFilter.FILTER_ACCEPT;
            }
        ); 
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

    formateUrl: function(url) {
        return url.replace(/^http(s)?\:/, '').replace(/^\/\//, '');
    },

    initGlobal: function() {
        return {
            // 是否已经上报的标志
            hasReported: false,

            // 是否抓取过请求的标志位
            isFirstRequestSent: false,

            recordType: 'auto', // 记录首屏记录方式，auto / hand

            // 可以抓取请求的时间窗口队列
            catchRequestTimeSections: [],

            // 统计没有被计入首屏的图片有哪些，和更详细的信息
            ignoredImages: [],

            // 设备信息，用于样本分析
            device: {},

            requestDetails: {},

            delayAll: 0,

            // 一些可配置项，下面是默认值
            options: {
                onTimeFound: function () { },
                request: {
                    limitedIn: [],
                    exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
                },

                // 获取数据后，认为渲染 dom 的时长；同时也是串联请求的等待间隔
                renderTimeAfterGettingData: 1000,

                // 找到首屏时间后，延迟上报的时间，默认为 500ms，防止页面出现需要跳转到登录导致性能数据错误的问题
                delayReport: 500,

                // onload 之后延时一段时间，如果到期后仍然没有异步请求发出，则认为是纯静态页面
                watingTimeWhenDefineStaticPage: 5000,

                img: [/(\.)(png|jpg|jpeg|gif|webp)/i] // 匹配图片的正则表达式
            }
        }
    },

    getTime: function() {
        return new Date().getTime();
    },

    mergeGlobal: function(defaultGlobal, privateGlobal) {
        var key;
        for (key in privateGlobal) {
            if (!/options/.test(key)) {
                defaultGlobal[key] = privateGlobal[key];
            }
        }

        if (privateGlobal.options) {
            for (key in privateGlobal.options) {
                defaultGlobal.options[key] = privateGlobal.options[key];
            }
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

    overrideRequest: function(_global, onStable) {
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

            // 如果已经上报，则不再抓取请求
            if (_global.hasReported) {
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
            for (var i = 0, len = _global.options.request.limitedIn.length; i < len; i++) {
                if (!_global.options.request.limitedIn[i].test(url)) {
                    shouldCatch = false;
                }
            }

            for (var i = 0, len = _global.options.request.exclude.length; i < len; i++) {
                if (_global.options.request.exclude[i].test(url)) {
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
            _global.catchRequestTimeSections.push([returnTime, returnTime + _global.options.renderTimeAfterGettingData]);

            var renderDelayTimer = setTimeout(function () {
                requestTimerStatusPool[requestKey] = 'stopped';
                if (hasAllReuestReturned() && isRequestTimerPoolEmpty()) {
                    onStable();
                }
                clearTimeout(renderDelayTimer);
            }, _global.options.renderTimeAfterGettingData);
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

    mergeUserOptions: function(_global, userOptions) {
        if (userOptions) {
            if (userOptions.delayReport) {
                _global.options.delayReport = userOptions.delayReport;
            }

            if (userOptions.watingTimeWhenDefineStaticPage) {
                _global.options.watingTimeWhenDefineStaticPage = userOptions.watingTimeWhenDefineStaticPage;
            }

            if (userOptions.onTimeFound) {
                _global.options.onTimeFound = function () {
                    var _this = this;
                    var args = arguments;

                    // delay a piece of time for reporting
                    var timer = setTimeout(function () {
                        userOptions.onTimeFound.apply(_this, args);
                        clearTimeout(timer);
                    }, _global.options.delayReport);
                };
            }

            var requestConfig = userOptions.request || userOptions.xhr;
            if (requestConfig) {
                if (requestConfig.limitedIn) {
                    _global.options.request.limitedIn = _global.options.request.limitedIn.concat(requestConfig.limitedIn);
                }
                if (requestConfig.exclude) {
                    _global.options.request.exclude = _global.options.request.exclude.concat(requestConfig.exclude);
                }
            }

            if (userOptions.renderTimeAfterGettingData) {
                _global.options.renderTimeAfterGettingData = userOptions.renderTimeAfterGettingData;
            }

            if (userOptions.onAllXhrResolved) {
                _global.options.onAllXhrResolved = userOptions.onAllXhrResolved;
            }

            if (userOptions.img) {
                if (typeof userOptions.img === 'object' && typeof userOptions.img.test === 'function') {
                    _global.options.img.push(userOptions.img);
                } else {
                    console.error('[auto-compute-first-screen-time] param "img" should be type RegExp');
                }
            }
        }
    },

    insertTestTimeScript: function(onStable, _global) {
        window.addEventListener('load', function () {
            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                // clear
                clearTimeout(timer);

                if (!_global.isFirstRequestSent) {
                    onStable();
                }
            }, _global.options.watingTimeWhenDefineStaticPage);
        });
    }
};
