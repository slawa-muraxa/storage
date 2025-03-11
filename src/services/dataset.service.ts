import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';

@Injectable()
export class DatasetService {
    private parser: XMLParser;

    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "",
        });
    }

    readMetadata(xmlFilePath: string) {
        const xmlData = fs.readFileSync(xmlFilePath, 'utf-8');
        const result = this.parser.parse(xmlData);

        // Extract total number of frames
        const total_frames = result.annotations.meta.job ? parseInt(result.annotations.meta.job.size, 10) : parseInt(result.annotations.meta.task.size, 10);

        // Initialize sets to collect unique frames
        const annotatedFramesSet = new Set<number>();
        const exportFramesSet = new Set<number>();

        // Initialize counters
        let key_annotations = 0;
        let total_annotations = 0;

        // Ensure tracks are processed as an array
        const tracks = Array.isArray(result.annotations.track) ? result.annotations.track : [result.annotations.track];

        if (tracks) {
            tracks.forEach(track => {
                if (track.box) {
                    const boxes = Array.isArray(track.box) ? track.box : [track.box];
                    boxes.forEach(box => {
                        total_annotations += 1;
                        exportFramesSet.add(parseInt(box.frame, 10));

                        if (box.keyframe === "1") {
                            key_annotations += 1;
                            annotatedFramesSet.add(parseInt(box.frame, 10));
                        }
                    });
                }
            });
        }
        return [
            { name: "key_annotations", value: key_annotations },
            { name: "total_annotations", value: total_annotations },
            { name: "key_frames", value: annotatedFramesSet.size },
            { name: "annotated_frames", value: exportFramesSet.size },
            { name: "total_frames", value: total_frames }
        ];
    }

    readObjects(xmlFilePath: string) {
        const xmlData = fs.readFileSync(xmlFilePath, 'utf-8');
        const result = this.parser.parse(xmlData);

        const labelsMap = new Map<string, { name: string; value: number; color: string }>();

        // Extract labels and colors
        const labels = result.annotations.meta.task.labels.label;
        const labelArray = Array.isArray(labels) ? labels : [labels];

        labelArray.forEach(label => {
            labelsMap.set(label.name, { name: label.name, value: 0, color: label.color });
        });

        // Process tracks and count boxes per label
        const tracks = Array.isArray(result.annotations.track) ? result.annotations.track : [result.annotations.track];

        tracks.forEach(track => {
            if (labelsMap.has(track.label)) {
                const boxes = Array.isArray(track.box) ? track.box : [track.box];
                labelsMap.get(track.label)!.value += boxes.length;
            }
        });

        return Array.from(labelsMap.values());
    }

}