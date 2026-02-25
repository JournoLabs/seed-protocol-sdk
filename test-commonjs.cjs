// Test CommonJS compatibility
const { Model, Property, Item, ItemProperty } = require('./dist/main.cjs');

console.log('✅ CommonJS import successful!');
console.log('Model:', typeof Model);
console.log('Property:', typeof Property);
console.log('Item:', typeof Item);
console.log('ItemProperty:', typeof ItemProperty);

// Test that we can access the exports
if (Model && Property && Item && ItemProperty) {
  console.log('✅ All exports are available');
} else {
  console.log('❌ Some exports are missing');
} 