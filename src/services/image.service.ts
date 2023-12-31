import axios, { AxiosResponse } from 'axios';
import { ImageMetadata } from '../schemas/image-metadata';
import { faker } from '@faker-js/faker';
import {
  ImageMetadataEntity,
  ImagePostRequestParams,
} from '../models/image-metadata';
import FormData from 'form-data';
import * as fs from 'fs';
import { extractHighConfidenceTags } from '../lib/extract-tags';
import { IMAGE_FILE_NOT_FOUND } from '../constants/messages.constants';
import { Tags } from 'exifreader';

/**
 * Singleton ImageService that provides operations on image data
 */
class ImageService {
  static async getImagesByObjects(
    objects: string[],
  ): Promise<ImageMetadataEntity[]> {
    if (objects.length === 0) {
      return ImageMetadata.find({});
    }

    return ImageMetadata.find({
      objects: { $in: objects },
    });
  }

  static async getImageById(id: string): Promise<ImageMetadataEntity | null> {
    return ImageMetadata.findById(id);
  }

  /**
   * Create an image and add to the database, applying object detection
   * if requested.
   * @param body
   * @param authorizationHeader
   * @returns
   */
  static async createImage(
    body: ImagePostRequestParams,
    imageProperties: Tags,
    isUploadedFile: boolean,
    authorizationHeader: string,
  ): Promise<ImageMetadataEntity> {
    const imageSource = body.imageSource;
    const label = body.label ? body.label : faker.string.uuid();
    const enableObjectDetection = body.enableObjectDetection;
    let objects: string[] = [];

    if (enableObjectDetection) {
      objects = await this.evaluateImage(
        imageSource,
        isUploadedFile,
        authorizationHeader,
      );
    }

    const entity = { imageSource, label, objects, imageProperties };
    const image = ImageMetadata.build(entity);
    let result;
    // if dryRun enabled, do not persist data
    if (!body.dryRun) {
      result = await image.save();
    }

    return {
      _id: result?._id,
      ...entity,
    };
  }

  /**
   * Use Imagga API to parse a passed in image url and determine the
   * objects that are within the image.
   * @param imageUrl
   * @param authorizationHeader
   * @returns Promise<string[]>
   */
  static async evaluateImage(
    imageUrl: string,
    isUploadedFile: boolean,
    authorizationHeader: string,
  ): Promise<string[]> {
    let url;
    if (isUploadedFile) {
      // eslint-disable-next-line max-len
      url = `https://api.imagga.com/v2/tags?image_upload_id=${encodeURIComponent(
        imageUrl,
      )}`;
    } else {
      url = `https://api.imagga.com/v2/tags?image_url=${encodeURIComponent(
        imageUrl,
      )}`;
    }
    const response = await axios.get(url, {
      headers: {
        Authorization: authorizationHeader,
      },
    });
    return extractHighConfidenceTags(response.data);
  }

  /**
   * Upload an image using Imagga's built-in uploading feature, and return
   * the response which contains the upload_id. This upload_id can be used
   * to parse an image.
   * @param filePath : string
   * @param authorizationHeader : string
   * @returns Promise<AxiosResponse>
   */
  static async uploadImage(
    filePath: string,
    authorizationHeader: string,
  ): Promise<AxiosResponse> {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(filePath));
    const url = 'https://api.imagga.com/v2/uploads';

    return await axios.post(url, formData, {
      headers: {
        Authorization: authorizationHeader,
      },
    });
  }

  static async handleLocalFile(
    imageSource: string,
    authorizationHeader: string,
  ): Promise<string> {
    if (!fs.existsSync(imageSource)) {
      throw Error(IMAGE_FILE_NOT_FOUND);
    }
    // If it is a local file, upload it to Imagga and set
    // isUploadFile to true
    const response = await ImageService.uploadImage(
      imageSource,
      authorizationHeader,
    );
    const { data } = response;
    return data.result.upload_id;
  }
}

export default ImageService;
