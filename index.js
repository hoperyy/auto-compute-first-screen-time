/**
 * @description compute first screen time of one page with inaccuracy less than 250ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

var supportQuerySelector = !!document.querySelector;
var supportTiming = window.performance && window.performance.timing;
var supportPerformance = window.performance && window.performance.getEntries && typeof window.performance.getEntries === 'function' && (window.performance.getEntries() instanceof Array);

// 强制使用打点方式获取首屏时间
// supportPerformance = false;

var generateOutput = function(perf, dot) {
    return function(options) {
        if (!supportQuerySelector || !supportTiming) {
            console.log('[auto-compute-first-screen-time] current browser doesn\'t support performance.timing. Page performance computation failed.');
            return;
        }

        var forcedType = 'auto';

        if (options && options.type) {
            forcedType = options.type;
        }

        if (forcedType !== 'auto' && forcedType !== 'perf' && forcedType !== 'dot') {
            console.error('[auto-compute-first-screen-time] error message: config option of "type" should be one of values as below: "auto/perf/dot"');
            return;
        }

        var supportPerf = supportQuerySelector && supportPerformance;

        if (forcedType === 'auto') {
            if (supportPerf) {
                perf(options);
            } else {
                dot(options);
            }
        } else if (forcedType === 'perf') {
            if (supportPerf) {
                perf(options);
            } else {
                console.log('[auto-compute-first-screen-time] current browser doesn\'t support performance API, so forced type "perf" is ignored.');
            }
        } else if (forcedType === 'dot') {
            dot(options);
        }
    };
};

var perfHandler = require('./perf');
var dotHandler = require('./dot');

module.exports = generateOutput(perfHandler.auto, dotHandler.auto);
module.exports.report = generateOutput(perfHandler.hand, dotHandler.hand);
