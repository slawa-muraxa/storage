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
OBJECTS='{"objectNames": ["test/bmp_13m.mp4", "test/bmp_13o.mp4"]}' 

# Expected Output for Comparison
EXPECTED_JSON='{
  "id": "test/bmp_13m.mp4",
  "active": true,
  "bucket": "l1-raw",
  "etag": "c851844bfe74d9da418cc21bf2b0edd4",
  "name": "test/bmp_13m.mp4",
  "original": true,
  "preview": false,
  "size": 2099183,
  "sources": [],
  "targets": [
    {
      "serviceName": "STORAGE_VERSION",
      "trackingId": "\"a4303bdb671045fa5f34f39d178ef83f\"",
      "references": {
        "objectName": "test/bmp_13m_1738257486456.mp4"
      },
      "_id": "679bb44ed2805df52802f52d"
    },
    {
      "serviceName": "STORAGE_LAKE",
      "trackingId": "bmp_13m.mp4",
      "references": {
        "targetPath": "alpha-project/bmp_13m.mp4/images/default"
      },
      "_id": "679bb474d2805df52802f54a"
    }
  ],
  "activeVersion": "test/bmp_13m_1738257486456.mp4",
  "metadata": {
    "video": {
      "length": 26.194921,
      "bitRate": 91321,
      "codec": "h264",
      "fps": 26.510130657072523,
      "numberOfFrames": 14,10.1000
      "width": 904,
      "height": 720,
      "quality": {
        "qualityScore": 1,
        "qualityDescription": "Low",
        "bitRatePerFrame": 0.0034447585785714286,
        "bitrateRatio": 0.0365284
      }
    }
  }
}'

# Delete metadata.targets field from the MongoDB record
echo "Deleting metadata.targets from MongoDB record..."
mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  db.getCollection("storage.l1-raw.objects").updateOne(
    { id: "test/bmp_13m.mp4" },
    { $unset: { "metadata.targets": [] } }
  );
  print("metadata.targets field deleted from object test/bmp_13m.mp4");
'

# Test Endpoint
echo "Testing /ingest-video endpoint..."
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  --data-raw "$OBJECTS" )

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

# Fetch MongoDB record and ensure it's output as valid JSON
MONGODB_RECORD=$(mongosh --quiet --host localhost:37017 --eval '
  db = connect("mongodb://localhost:37017/storage");
  JSON.stringify(db.getCollection("storage.l1-raw.objects").findOne({ id: "test/bmp_13m.mp4" }))
')

# Filter MongoDB record to exclude _id, __v, lastModified using jq
FILTERED_MONGODB_RECORD=$(echo "$MONGODB_RECORD" | jq 'del(._id, .__v, .lastModified)')

echo "Filtered MongoDB Record:"
echo "$FILTERED_MONGODB_RECORD"
echo ""

# Compare MongoDB record with expected JSON
if echo "$FILTERED_MONGODB_RECORD" | jq --argjson expected "$EXPECTED_JSON" -e 'if . == $expected then true else false end' > /dev/null; then
  echo "MongoDB record matches expected output!"
else
  echo "MongoDB record does NOT match expected output!"
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
if echo "$MESSAGE" | jq -e '.etag and .sourceVideo and .bucket' >/dev/null 2>&1; then
  echo "Message is valid and contains required properties."
  echo "$MESSAGE"
else
  echo "Message does not contain required properties."
  exit 1
fi

echo "Test completed successfully."
