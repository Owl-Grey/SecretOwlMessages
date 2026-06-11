export const appConfig = {
  maxImageSizeMb: Number(import.meta.env.VITE_MAX_IMAGE_SIZE_MB || 10),
  maxFileSizeMb: Number(import.meta.env.VITE_MAX_FILE_SIZE_MB || 25),
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
};

appConfig.maxImageSizeBytes = appConfig.maxImageSizeMb * 1024 * 1024;
appConfig.maxFileSizeBytes = appConfig.maxFileSizeMb * 1024 * 1024;
