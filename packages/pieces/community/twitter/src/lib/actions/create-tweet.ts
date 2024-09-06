import {
  ApFile,
  createAction,
} from '@activepieces/pieces-framework';
import { TwitterApi } from 'twitter-api-v2';
import { twitterAuth } from '../..';
import { twitterCommon } from '../common';

const getMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'mp4': 'video/mp4',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
};

const uploadMedia = async (client: TwitterApi, file: ApFile): Promise<string> => {
  const buffer = Buffer.from(file.base64, 'base64');
  const mimeType = getMimeType(file.filename);

  if (mimeType.startsWith('video/')) {
    const mediaId = await client.v1.uploadMediaChunked(buffer, { mimeType });
    return mediaId;
  } else {
    return client.v1.uploadMedia(buffer, { mimeType });
  }
};

export const createTweet = createAction({
  auth: twitterAuth,

  name: 'create-tweet',
  displayName: 'Create Tweet',
  description: 'Create a tweet',
  props: {
    text: twitterCommon.text,
    image_1: twitterCommon.image_1,
    image_2: twitterCommon.image_2,
    image_3: twitterCommon.image_3,
  },
  async run(context) {
    const { consumerKey, consumerSecret, accessToken, accessTokenSecret } =
      context.auth;
    const userClient = new TwitterApi({
      appKey: consumerKey,
      appSecret: consumerSecret,
      accessToken: accessToken,
      accessSecret: accessTokenSecret,
    });

    try {
      const media: ApFile[] = [
        context.propsValue.image_1,
        context.propsValue.image_2,
        context.propsValue.image_3,
      ].filter((m): m is ApFile => !!m);

      const uploadedMedia = await Promise.all(media.map(m => uploadMedia(userClient, m)));

      const response = uploadedMedia.length > 0
        ? await userClient.v2.tweet(context.propsValue.text, {
            media: {
              media_ids: uploadedMedia,
            },
          })
        : await userClient.v2.tweet(context.propsValue.text);

      return response || { success: true };
    } catch (error: any) {
      throw new Error(
        JSON.stringify({
          code: error.code,
          errors: error.errors,
        })
      );
    }
  },
});
