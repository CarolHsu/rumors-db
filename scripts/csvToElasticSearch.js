import '../util/catchUnhandledRejection';

import config from 'config';
import elasticsearch from 'elasticsearch';
import parse from 'csv-parse/lib/sync';
import { readFileSync } from 'fs';
import { compareTwoStrings } from 'string-similarity';
import ProgressBar from 'progress';
import readline from 'readline';

if(process.argv.length !== 3) {
  console.log("Usage: babel-node scripts/csvToElasticSearch.js <PATH_TO_CSV_FILE>");
  process.exit(1);
}

const MIN_SIMILARITY = 0.4;
const SAFE_SIMILARITY = 0.7;

const client = new elasticsearch.Client({
  host: config.get('ELASTICSEARCH_URL'),
  log: 'trace',
});

const records = parse(readFileSync(process.argv[2], 'utf-8'), {columns: true})
aggregateRowsToDocs(records).then(({rumors, answers}) =>
  Promise.all([
    writeToElasticSearch('rumors', rumors),
    writeToElasticSearch('answers', answers),
  ])
);

async function aggregateRowsToDocs(rows) {
  const rumors = []; // rumors docs to return
  const answers = []; // answer docs to return
  const rumorTexts = []; // cached text array. Should be 1-1 mapping to rumors[].
  const answerTexts = []; // cached text array. Should be 1-1 mapping to answers[].

  const bar = new ProgressBar('Aggregating Rows :bar', { total: rows.length })

  for(const record of rows) {
    let rumor;
    const rumorText = record['Rumor Text'];
    const {idx: rumorIdx, similarity: rumorSimilarity} = findDuplication(rumorTexts, rumorText);

    if(
      rumorIdx !== -1 && (
        rumorSimilarity > SAFE_SIMILARITY ||
        console.log("\nSimilarity =", rumorSimilarity) || await askSimilarity(rumors[rumorIdx].text, rumorText)
      )
    ) {
      rumor = rumors[rumorIdx];
    } else {
      rumor = {
        id: `${record['Message ID']}-rumor`,
        text: rumorText,
        answerIds: [],
      };
      rumors.push(rumor);
      rumorTexts.push(rumorText);
    }

    if(record['Answer']) {
      const answerText = record['Answer'];
      const {idx: answerIdx, similarity: answerSimilarity} = findDuplication(answerTexts, answerText);
      let answer;

      if(answerIdx !== -1 && (
        answerSimilarity > SAFE_SIMILARITY ||
        console.log("\nSimilarity =", answerSimilarity) || await askSimilarity(answers[answerIdx].versions[0].text, answerText)
      )) {
        answer = answers[answerIdx];
      } else {
        answer = {
          id: `${record['Message ID']}-answer`,
          versions: [{
            text: record['Answer'],
            reference: record['Reference'],
          }],
        };
        answers.push(answer);
        answerTexts.push(answerText);
      }

      rumor.answerIds.push(answer.id);
    }

    bar.tick();
  };

  return {rumors, answers};
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

function findDuplication(texts, target) {
  let idx = -1;
  let bestSimilarity = MIN_SIMILARITY;

  texts.forEach((text, i) => {
    const similarity = compareTwoStrings(text, target);
    if(similarity > bestSimilarity) {
      idx = i;
      bestSimilarity = similarity;
    }
  });

  return {idx, similarity: bestSimilarity};
}

function askSimilarity(doc1, doc2) {
  return new Promise(function(resolve, reject) {
    console.log('\n==============================');
    console.log(doc1);
    console.log('------------------------------');
    console.log(doc2);
    console.log('==============================\n');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question("Are these 2 documents the same? (Y/n)", ans => {
      if(ans === 'n') resolve(false);
      else resolve(true);
      rl.close()
    })
  });
}
