module.exports = {
    watchingNavStartChange: false,
    navigationTagChangeMap: {
        realChangeList: [],
        usedChangeList: []
    },
    onloadFinished: false,
    supportPerformance: ('performance' in window) && ('getEntriesByType' in window.performance) && (window.performance.getEntriesByType('resource') instanceof Array)
};