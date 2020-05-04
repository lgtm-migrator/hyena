import dotenv from 'dotenv';
import Sentry from '@sentry/node';

dotenv.config();
Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

import AWS from 'aws-sdk';
import fetch from 'node-fetch';
import Twitter from 'twitter';

const rekognition = new AWS.Rekognition();
const twitter = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY || '',
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET || '',
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY || '',
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET || ''
});

const main = async () => {
  const twitterResponse = await twitter.get('search/tweets', {
    q: `exclude:retweets filter:images -filter:replies ${process.env.SEARCH_QUERY}`,
    result_type: 'recent',
  });

  for (const status of twitterResponse.statuses) {
    const media = status.extended_entities?.media[0];

    if (!media || media.type !== 'photo') {
      continue;
    }

    const image = await fetch(media.media_url_https);
    const { Labels } = await rekognition.detectLabels({
      Image: {
        Bytes: await image.buffer()
      },
    }).promise();

    if (!(Labels?.some(({ Name }) => process.env.LABELS?.split(',').includes(Name || '')))) {
      continue;
    }

    await twitter.post('favorites/create', {id: status.id_str});
    await twitter.post('statuses/retweet', {id: status.id_str});

    break;
  }
}

main();
