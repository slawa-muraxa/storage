#!/bin/bash

# Function to display usage instructions
usage() {
    echo "Usage: $0 [-c]"
    echo "  -c    Run stack excluding 'muraxa-storage' container"
    exit 1
}

# Parse command-line arguments
while getopts "c" opt; do
    case "$opt" in
        c)
            # Run all containers except 'muraxa-storage'
            echo "Running docker-compose up excluding 'muraxa-storage' container"
            docker-compose up -d $(docker-compose config --services | grep -v 'muraxa-storage')
            exit 0
            ;;
        *)
            usage
            ;;
    esac
done

# If no flags are provided, just run docker-compose up normally
echo "Running docker-compose up"
docker-compose up -d