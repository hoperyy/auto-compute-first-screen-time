module.exports = {
    getDomCompleteTime: function(callback, desc) {
        var modifyDomCompleteCount = 0;
        var handler = function () {
            if (performance.timing.domComplete != 0) {
                callback(performance.timing.domComplete);
            }

            if (++modifyDomCompleteCount >= 10 || performance.timing.domComplete != 0) {
                console.log('~~~ clearInterval');
                clearInterval(modifyDomCompleteTimer);
            }
        };
        console.log(desc);
        // 轮询获取 domComplete 的值，最多轮询 10 次
        
        var modifyDomCompleteTimer = setInterval(handler, 1000);

        handler();
    }
};
