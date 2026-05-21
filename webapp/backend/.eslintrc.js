module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
  plugins: ["security"],
  extends: ["eslint:recommended", "plugin:security/recommended-legacy"],
  rules: {
    // Disallow console.* in production code (logger.js is used instead)
    "no-console": "error",

    // Security plugin overrides — tighten defaults
    "security/detect-object-injection":        "warn",
    "security/detect-non-literal-regexp":      "warn",
    "security/detect-non-literal-require":     "error",
    "security/detect-possible-timing-attacks": "warn",
    "security/detect-eval-with-expression":    "error",
    "security/detect-child-process":           "warn",

    // Code quality
    "no-unused-vars":  ["error", { argsIgnorePattern: "^_" }],
    "no-var":          "error",
    "prefer-const":    "error",
    "eqeqeq":          ["error", "always"],
  },
  ignorePatterns: [
    "node_modules/",
    "tests/stubs/",
    "coverage/",
  ],
};
