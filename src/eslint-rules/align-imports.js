module.exports = {
  meta: {
    type: 'layout',
    docs: {
      description: 'Align import statements on the from keyword',
      category: 'Stylistic Issues',
    },
    fixable: 'whitespace',
  },
  create(context) {
    const sourceCode = context.getSourceCode();

    return {
      Program(node) {
        // Get all import declarations
        const imports = node.body.filter(n => n.type === 'ImportDeclaration');
        if (imports.length <= 1) return;

        // Find the position of 'from' in each import
        const fromPositions = imports.map(imp => {
          const fromToken = sourceCode.getTokens(imp)
            .find(token => token.value === 'from');
          return fromToken.range[0];
        });

        // Find the maximum position
        const maxFromPosition = Math.max(...fromPositions);

        // Check and fix alignment
        imports.forEach((imp, index) => {
          const fromToken = sourceCode.getTokens(imp)
            .find(token => token.value === 'from');
          const currentPosition = fromPositions[index];

          if (currentPosition < maxFromPosition) {
            const spacingNeeded = maxFromPosition - currentPosition;

            context.report({
              node: imp,
              message: 'Import statements should align on the from keyword',
              fix(fixer) {
                return fixer.insertTextBefore(
                  fromToken,
                  ' '.repeat(spacingNeeded)
                );
              }
            });
          }
        });
      }
    };
  }
}; 