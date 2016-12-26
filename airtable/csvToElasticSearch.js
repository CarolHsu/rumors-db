import config from 'config';
import elasticsearch from 'elasticsearch';
import parse from 'csv-parse/lib/sync';
import {readFileSync} from 'fs';

if(process.argv.length !== 2) {
  console.log("Usage: babel-node scripts/csvToElasticSearch.js <PATH_TO_CSV_FILE>");
  return 1;
}

const client = new elasticsearch.Client({
  host: config.get('ELASTICSEARCH_URL'),
  log: 'trace',
});

const records = parse(readFileSync(process.argv[1], 'utf-8'), {columns: true})
const {rumors, answers} = aggregateRows(records);

writeToElasticSearch('rumors', rumors);
writeToElasticSearch('answers', answers);

function aggregateRows(rows) {
  const data = {
    rumors: [],
    answers: [],
  };

  records.forEach(function(record) {
    const answer = record['Answer'];
    const answerIds = []

    if(answer) {
      answerIds.push(`${record['Message ID']}-answer`);
    }

    data.rumors.push({
      id: `${record['Message ID']}-rumor`,
      text: record['Rumor Text'],
      answerIds,
    });

    if(record['Answer']) {
      data.answers.push({
        id: answerIds[0],
        versions: [{
          text: record['Answer'],
          reference: record['Reference'],
        }],
      });
    }
  });

  return data;
}

function writeToElasticSearch(indexName, records){
  const body = [];

  records.forEach(({id, ...doc}) => {
    // action description
    body.push({index: {_index: indexName, _type: 'basic', _id: id}});
    // document
    body.push(doc);
  });

  return client.bulk({
    body
  })
}
