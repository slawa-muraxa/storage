#!/bin/bash

# Define variables
FILE_PATH="scripts/data/alpha-project---bmp_13m.mp4.zip"
BUCKET_NAME="l2-prep"
SUBDIRECTORY="annotations"
TARGET_PATH="${BUCKET_NAME}/${SUBDIRECTORY}/alpha-project---bmp_13m.mp4.zip"
CHECK_PATH="myminio/l4-dl/alpha-project/bmp_13m.mp4/annotations/default.json"
TIMEOUT=30
INTERVAL=2
TOPIC="annotation-dataset-update"
BROKER="localhost:9092" # Adjust broker address if needed

# Upload the file to MinIO
mc cp "$FILE_PATH" "myminio/$TARGET_PATH"

# Check if the upload was successful
if [ $? -ne 0 ]; then
  echo "Error uploading file."
  exit 1
fi

echo "File successfully uploaded to ${TARGET_PATH}."

# Wait for default.json to appear
echo "Checking for default.json in ${CHECK_PATH}..."
SECONDS_ELAPSED=0
while [ $SECONDS_ELAPSED -lt $TIMEOUT ]; do
  if mc stat "$CHECK_PATH" >/dev/null 2>&1; then
    echo "default.json is present."
    break
  fi
  sleep $INTERVAL
  SECONDS_ELAPSED=$((SECONDS_ELAPSED + INTERVAL))
done

if [ $SECONDS_ELAPSED -ge $TIMEOUT ]; then
  echo "default.json not found in ${CHECK_PATH} after ${TIMEOUT} seconds."
  exit 1
fi

# Wait and validate Kafka message
echo "Waiting for message on Kafka topic ${TOPIC}..."
MESSAGE=$(kafka-console-consumer --bootstrap-server "$BROKER" \
                                 --topic "$TOPIC" \
                                 --timeout-ms $((TIMEOUT * 1000)) \
                                 --max-messages 1 2>/dev/null)

if [ -z "$MESSAGE" ]; then
  echo "No message received within ${TIMEOUT} seconds."
  exit 1
fi

echo "Received message: $MESSAGE"

# Validate message contains required properties
if echo "$MESSAGE" | jq -e '.relativePath and .targetPath and .bucket' >/dev/null 2>&1; then
  echo "Message is valid and contains required properties."
else
  echo "Message does not contain required properties."
  exit 1
fi

echo "Test completed successfully."