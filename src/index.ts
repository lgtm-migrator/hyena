import * as AWS from "aws-sdk";
import * as crypto from "crypto";
import fetch from "node-fetch";
import * as Twitter from "twitter";

const handler = async (): Promise<void> => {
  const dynamoDB = new AWS.DynamoDB({
    apiVersion: "2012-08-10",
    endpoint:
      process.env.DYNAMODB_ENDPOINT === ""
        ? undefined
        : process.env.DYNAMODB_ENDPOINT,
  });

  const rekognition = new AWS.Rekognition();

  const twitter = new Twitter({
    /* eslint-disable @typescript-eslint/camelcase */
    consumer_key: process.env.TWITTER_CONSUMER_KEY ?? "",
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET ?? "",
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY ?? "",
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET ?? "",
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
    const id = crypto.createHash("sha256").update(imageBuffer).digest("hex");

    const item = await dynamoDB
      .getItem({
        TableName: process.env.DYNAMODB_TABLE_NAME ?? "",
        Key: {
          id: { S: id },
        },
      })
      .promise();

    if (item.Item) {
      continue;
    }

    const { Labels } = await rekognition
      .detectLabels({
        Image: {
          Bytes: imageBuffer,
        },
      })
      .promise();

    if (
      !Labels?.some(
        ({ Confidence, Name }) =>
          Confidence &&
          Confidence >= 50 &&
          process.env.LABELS?.split(",").includes(Name ?? "")
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

    await dynamoDB
      .putItem({
        TableName: process.env.DYNAMODB_TABLE_NAME ?? "",
        Item: {
          id: { S: id },
        },
      })
      .promise();

    await twitter.post("favorites/create", { id: status.id_str });
    await twitter.post("statuses/retweet", { id: status.id_str });

    break;
  }
};

export { handler };
