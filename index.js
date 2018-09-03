/**
 * @description compute first screen time of one page with inaccuracy less than 250ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

var supportQuerySelector = !!document.querySelector;
var supportPerformance = ('performance' in window) && ('getEntriesByType' in window.performance) && (window.performance.getEntriesByType('resource') instanceof Array);
var supportTiming = window.performance && window.performance.timing;

var noop = function() {};

// 强制使用打点方式获取首屏时间
// supportPerformance = false;

if (supportQuerySelector && supportPerformance) {
    module.exports = require('./perf').auto;
    module.exports.report = require('./perf').hand;
} else if (supportQuerySelector && supportTiming) {
    module.exports = require('./dot').auto;
    module.exports.report = require('./dot').hand;
} else {
    module.exports = noop;
    module.exports.report = noop;
}
