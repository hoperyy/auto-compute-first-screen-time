/**
 * @description auto compute first screen time of one page with inaccuracy less than 200ms
 * @author 刘远洋 https://github.com/hoperyy
 * @date 2018/02/22
 */

var supportPerformance = ('performance' in window) && ('getEntriesByType' in window.performance) && (window.performance.getEntriesByType('resource') instanceof Array);

// 用于测试
// supportPerformance = false;

// 轻量算法
if (supportPerformance) {
    module.exports = require('./prefer').auto;
    module.exports.report = require('./prefer').hand;
} else if (window.performance && window.performance.timing) {
    // 较重的算法，通过不断的打点获取首屏
    module.exports = require('./second').auto;
    module.exports.report = require('./second').hand;
} else {
    // 如果连 performance.timing 都不支持，就不再上报了
    module.exports = function () { };
    module.exports.report = function () { };
}
