import * as AWS from "aws-sdk";
import fetch from "node-fetch";
import * as Twitter from "twitter";

const handler = async (): Promise<void> => {
  const rekognition = new AWS.Rekognition();
  const twitter = new Twitter({
    /* eslint-disable @typescript-eslint/camelcase */
    consumer_key: process.env.TWITTER_CONSUMER_KEY || "",
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET || "",
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY || "",
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET || "",
    /* eslint-enable @typescript-eslint/camelcase */
  });

  const twitterResponse = await twitter.get("search/tweets", {
    q: `exclude:retweets filter:images -filter:replies ${process.env.SEARCH_QUERY}`,
    // eslint-disable-next-line @typescript-eslint/camelcase
    result_type: "recent",
  });

  for (const status of twitterResponse.statuses) {
    if (
      !status.extended_entities ||
      status.extended_entities.media.length !== 1
    ) {
      continue;
    }

    const firstMedia = status.extended_entities.media[0];

    if (firstMedia.type !== "photo") {
      continue;
    }

    const image = await fetch(firstMedia.media_url_https);
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

export { handler };
