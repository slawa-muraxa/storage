#!/bin/bash

# Variables
API_URL="http://localhost:3004/api/ingest-video"  # Replace with your actual API URL
MINIO_ALIAS="myminio"                        # Replace with your MinIO alias
SOURCE_BUCKET="l1-raw"
TARGET_BUCKET="l4-dl"
DST_PATH="bmp_13m.mp4/images/default"
OBJECT_NAME="test/bmp_13m.mp4" # Replace with your object name
PROJECT_NAME="alpha-project"               # Replace with your project name
DOWNLOAD_PATH="./downloads/$OBJECT_NAME"
TIMEOUT=30
INTERVAL=2
TOPIC="frame-update"
BROKER="localhost:9092" # Adjust broker address if needed

# Test Endpoint
echo "Testing /ingest-video endpoint..."
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"objectName\":\"$OBJECT_NAME\", \"projectName\":\"$PROJECT_NAME\"}")

# Parse Response
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | awk -F: '{print $2}')
BODY=$(echo "$RESPONSE" | sed -n '1,/HTTP_STATUS/ p' | sed '$d')

if [ "$HTTP_STATUS" -ne 200 ]; then
  echo "Endpoint call failed with status $HTTP_STATUS"
  echo "Response: $BODY"
  exit 1
fi

echo "Endpoint responded successfully."
echo "Response Body: $BODY"

# Verify objects in MinIO
echo "Verifying ingestion in bucket $TARGET_BUCKET..."
mc alias set $MINIO_ALIAS http://localhost:10000 admin adminadmin12 # Replace with your MinIO credentials

if ! mc ls "$MINIO_ALIAS/$TARGET_BUCKET/$PROJECT_NAME/$DST_PATH/" > /dev/null 2>&1; then
  echo "No objects found in $TARGET_BUCKET for $DST_PATH."
  exit 1
fi

echo "Objects found in $TARGET_BUCKET:"
mc ls "$MINIO_ALIAS/$TARGET_BUCKET/$PROJECT_NAME/$DST_PATH/"

# Cleanup
if [ -f "$DOWNLOAD_PATH" ]; then
  echo "Cleaning up downloaded file..."
  rm -f "$DOWNLOAD_PATH"
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
if echo "$MESSAGE" | jq -e '.etag and .sourceVideo and .bucket' >/dev/null 2>&1; then
  echo "Message is valid and contains required properties."
  echo "$MESSAGE"
else
  echo "Message does not contain required properties."
  exit 1
fi

echo "Test completed successfully."
