module.exports = {
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
        var modifyDomCompleteTimer = setInterval(handler, 1000);

        handler();
    },

    _getImgSrcFromDom: function (dom) {
        var src;

        if (dom.nodeName.toUpperCase() == 'IMG') {
            src = dom.getAttribute('src');
        } else {
            var computedStyle = window.getComputedStyle(dom);
            var bgImg = computedStyle.getPropertyValue('background-image') || computedStyle.getPropertyValue('background');

            var match = bgImg.match(/url\(.+\)/);
            src = match && match[1];
        }

        return src;
    },
    isInFirstScreen: function (currentNode) {
        var screenHeight = window.innerHeight;
        var screenWidth = window.innerWidth;

        // 过滤函数，如果符合要求，返回 true
        var boundingClientRect = currentNode.getBoundingClientRect();

        // 如果已不显示（display: none），top 和 bottom 均为 0
        if (!boundingClientRect.top && !boundingClientRect.bottom) {
            return false;
        }

        var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

        var top = boundingClientRect.top; // getBoundingClientRect 会引起重绘
        var left = boundingClientRect.left;
        var right = boundingClientRect.right;

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
    }
};
