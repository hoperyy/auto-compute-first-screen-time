module.exports = {
    watchingNavStartChange: false,
    navigationTagChangeMap: {
        realChangeList: [],
        usedChangeList: []
    },
    onloadFinished: false,
    supportPerformance: window.performance && window.performance.getEntries && typeof window.performance.getEntries === 'function' && (window.performance.getEntries() instanceof Array)
};