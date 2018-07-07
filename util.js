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
            var computedStyle = win.getComputedStyle(dom);
            var bgImg = computedStyle.getPropertyValue('background-image') || computedStyle.getPropertyValue('background');

            var match = bgImg.match(/url\(.+\)/);
            src = match && match[1];
        }

        return src;
    }
};
