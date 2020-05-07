import * as dotenv from "dotenv";
import * as Sentry from "@sentry/node";

dotenv.config();
Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

import * as AWS from "aws-sdk";
import fetch from "node-fetch";
import * as Twitter from "twitter";

const rekognition = new AWS.Rekognition();
const twitter = new Twitter({
  /* eslint-disable @typescript-eslint/camelcase */
  consumer_key: process.env.TWITTER_CONSUMER_KEY || "",
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET || "",
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY || "",
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET || "",
  /* eslint-enable @typescript-eslint/camelcase */
});

export const handler = async (): Promise<void> => {
  const twitterResponse = await twitter.get("search/tweets", {
    q: `exclude:retweets filter:images -filter:replies ${process.env.SEARCH_QUERY}`,
    // eslint-disable-next-line @typescript-eslint/camelcase
    result_type: "recent",
  });

  for (const status of twitterResponse.statuses) {
    const media = status.extended_entities?.media[0];

    if (!media || media.type !== "photo") {
      continue;
    }

    const image = await fetch(media.media_url_https);
    const imageBuffer = await image.buffer();
    const { Labels } = await rekognition
      .detectLabels({
        Image: {
          Bytes: imageBuffer,
        },
      })
      .promise();

    if (
      !Labels?.some(({ Name }) =>
        process.env.LABELS?.split(",").includes(Name || "")
      )
    ) {
      continue;
    }

    const { ModerationLabels } = await rekognition
      .detectModerationLabels({
        Image: {
          Bytes: imageBuffer,
        },
      })
      .promise();

    if (!ModerationLabels || ModerationLabels.length !== 0) {
      continue;
    }

    await twitter.post("favorites/create", { id: status.id_str });
    await twitter.post("statuses/retweet", { id: status.id_str });

    break;
  }
};

handler();
