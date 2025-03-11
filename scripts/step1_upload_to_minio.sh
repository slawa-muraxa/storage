#!/bin/bash

# Exit script on error
set -e

# MinIO configuration
MINIO_ALIAS="myminio" # Replace with your MinIO alias
MINIO_URL="http://localhost:10000" # Replace with your MinIO server URL
MINIO_USER="admin" # Replace with your MinIO root user
MINIO_PASSWORD="adminadmin12" # Replace with your MinIO root password
L1_BUCKET_NAME="l1-raw"
L3_BUCKET_NAME="l3-rel"
PREFIX="test"

# Array of video files to upload
VIDEO_FILES=("scripts/data/bmp_13m.mp4" "scripts/data/bmp_13o.mp4" "scripts/data/bmp_13p.mp4") # video file names
DATASET_FILES=("scripts/data/bmp_13m_cfv.zip") # zip file names

# Verify if mc is installed
if ! command -v mc &> /dev/null; then
    echo "MinIO Client (mc) is not installed. Please install it first."
    exit 1
fi

# Check if MinIO alias exists, if not create it
if ! mc alias ls | grep -q "$MINIO_ALIAS"; then
    echo "MinIO alias '$MINIO_ALIAS' not found. Creating it now..."
    mc alias set "$MINIO_ALIAS" "$MINIO_URL" "$MINIO_USER" "$MINIO_PASSWORD"
    echo "Alias '$MINIO_ALIAS' created successfully."
fi

# Ensure the bucket exists
if ! mc ls "$MINIO_ALIAS" | grep -q "$L1_BUCKET_NAME/"; then
    echo "Bucket '$L1_BUCKET_NAME' not found. Creating it now..."
    mc mb "$MINIO_ALIAS/$L1_BUCKET_NAME"
    echo "Bucket '$L1_BUCKET_NAME' created successfully."
fi

if ! mc ls "$MINIO_ALIAS" | grep -q "$L3_BUCKET_NAME/"; then
    echo "Bucket '$L3_BUCKET_NAME' not found. Creating it now..."
    mc mb "$MINIO_ALIAS/$L3_BUCKET_NAME"
    echo "Bucket '$L3_BUCKET_NAME' created successfully."
fi

# Upload each video file
for file in "${VIDEO_FILES[@]}"; do
    if [[ -f "$file" ]]; then
        echo "Uploading $file to $MINIO_ALIAS/$L1_BUCKET_NAME/$PREFIX/"
        mc cp "$file" "$MINIO_ALIAS/$L1_BUCKET_NAME/$PREFIX/"
        echo "$file uploaded successfully."
    else
        echo "File $file not found. Skipping..."
    fi
done

# Upload each video file
for file in "${DATASET_FILES[@]}"; do
    if [[ -f "$file" ]]; then
        echo "Uploading $file to $MINIO_ALIAS/$L3_BUCKET_NAME/$PREFIX/"
        mc cp "$file" "$MINIO_ALIAS/$L3_BUCKET_NAME/$PREFIX/"
        echo "$file uploaded successfully."
    else
        echo "File $file not found. Skipping..."
    fi
done

echo "All uploads completed."