const nlp = require('compromise');

// Test NER functionality
function testNER() {
  const text = "John Smith works at Microsoft in Seattle. He met Sarah Johnson at Amazon on January 15th, 2024.";
  
  console.log('Testing NER with text:', text);
  console.log('\n--- Results ---');
  
  const doc = nlp(text);
  
  const people = doc.people().out('array');
  const places = doc.places().out('array');
  const organizations = doc.organizations().out('array');
  const dates = doc.match('#Date').out('array');
  
  console.log('People:', people);
  console.log('Places:', places);
  console.log('Organizations:', organizations);
  console.log('Dates:', dates);
  
  // Combined entities
  const entities = [
    ...people.map(e => ({entity: e, type: 'PERSON'})),
    ...places.map(e => ({entity: e, type: 'LOCATION'})),
    ...organizations.map(e => ({entity: e, type: 'ORGANIZATION'})),
    ...dates.map(e => ({entity: e, type: 'DATE'}))
  ];
  
  console.log('\nAll entities:', entities);
}

testNER();