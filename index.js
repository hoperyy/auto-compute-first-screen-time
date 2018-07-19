/**
 * @description auto compute first screen time of one page with inaccuracy less than 200ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

var supportPerformance = ('performance' in window) && ('getEntriesByType' in window.performance) && (window.performance.getEntriesByType('resource') instanceof Array);

var supportQuerySelector = !!document.querySelector;

// 强制使用打点方式获取首屏时间
// supportPerformance = false;

// 轻量算法
if (supportQuerySelector && supportPerformance) {
    module.exports = require('./perf').auto;
    module.exports.report = require('./dot').hand;
} else if (supportQuerySelector && window.performance && window.performance.timing) {
    // 较重的算法，通过不断的打点获取首屏
    module.exports = require('./dot').auto;
    module.exports.report = require('./dot').hand;
} else {
    // 如果连 performance.timing 都不支持，就不再上报了
    module.exports = function () { };
    module.exports.report = function () { };
}
