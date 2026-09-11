module.exports = function (api) {
  api.cache(true);

  return {
    // babel-preset-expo already wires up the Reanimated / Worklets plugin and the
    // React Compiler when they are enabled in app.json, so we only add NativeWind here.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
