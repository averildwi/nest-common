module.exports = [
    // Install first: a failed install must leave no project files behind.
    require('./installDeps'),
    require('./copyCommon'),
    require('./registerAppModule'),
    require('./injectMain'),
    require('./updateEnv'),
    require('./lintFix'),
];
