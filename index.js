/**
 * @description compute first screen time of one page with inaccuracy less than 250ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

var supportQuerySelector = !!document.querySelector;
var supportPerformance = ('performance' in window) && ('getEntriesByType' in window.performance) && (window.performance.getEntriesByType('resource') instanceof Array);
var supportTiming = window.performance && window.performance.timing;
var supportNecessaryJsApis = (function(){
    var supportForin = true;
    try {
        var isAin = false;
        var isBin = false;
        for (var key in { testForInA: 1, testForInB: 2 }) {
            if (key === 'testForInA') {
                isAin = true;
            }
            if (key === 'testForInB') {
                isBin = true;
            }
        }

        if (!isAin || !isBin) {
            supportForin = false;
        }
    } catch(err) {
        supportForin = false;
    }

    return supportForin;
})();

var noop = function() {};

// 强制使用打点方式获取首屏时间
supportPerformance = false;

function getRandom() {
    var random = document.body.getAttribute('perf-random');

    if (typeof random === 'object' && random === null) {
        random = 1;
    }

    if (typeof random === 'string') {
        if (random.replace(/\s*/, '')) {
            random = parseFloat(random);
        } else {
            random = 1; // blank string
        }
    }

    // backup
    if (!random && random !== 0) {
        random = 1;
    }

    if (random > 1) {
        random = 1;
    }

    if (random < 0) {
        random = 0;
    }

    return random;
}

if (supportNecessaryJsApis && supportQuerySelector) {
    var forceDot = document.querySelector('[perf-dot]') === document.body;

    if (Math.random() > getRandom()) {
        module.exports = noop;
        module.exports.report = noop;
    } else {
        if (forceDot) {
            if (supportTiming) {
                module.exports = require('./dot').auto;
                module.exports.report = require('./dot').hand;
            } else {
                module.exports = noop;
                module.exports.report = noop;
            }
        } else {
            if (supportPerformance) {
                module.exports = require('./perf').auto;
                module.exports.report = require('./perf').hand;
            } else if (supportTiming) {
                module.exports = require('./dot').auto;
                module.exports.report = require('./dot').hand;
            } else {
                module.exports = noop;
                module.exports.report = noop;
            }
        }
    }
} else {
    module.exports = noop;
    module.exports.report = noop;
}
