export class TaskMessageDTO {
    readonly id: number;
    readonly name: string;
    readonly projectName: string;
    readonly url: string;
    readonly bug_tracker: string;
    readonly labels: any[];
    readonly deleted: boolean;
    readonly size: number;
    readonly owner: any;
}