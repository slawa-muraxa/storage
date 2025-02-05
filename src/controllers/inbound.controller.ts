import { Controller, Inject, Logger } from '@nestjs/common';
import { TaskMessageDTO } from '../dto/task.message.dto';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { StorageService } from 'src/services/storage.service';
import { StorageConnector } from 'src/connectors/storage.connector';
import { LineageService, LinkType } from 'src/services/lineage.service';
import { ServiceName } from 'src/schemas/sobject.schema';

@Controller()
export class InboundController {

  private readonly logger = new Logger(InboundController.name);

  constructor(
    private readonly storageService: StorageService,
    @Inject('StorageConnector') private readonly s3: StorageConnector,
    private readonly lineage: LineageService,
  ) { }

  @MessagePattern('task')
  async updateTask(@Payload() task: TaskMessageDTO) {
    const taskObjectName = `${task.projectName}/${task.name}`;
    const sourceObjectName = task.bug_tracker;
    const taskObject = await this.storageService.getObject("l2-proc", taskObjectName);
    const sourceObject = await this.storageService.getObject("l1-raw", sourceObjectName);

    if (!taskObject) {

      this.logger.debug("Creating l2-proc/" + taskObjectName);
      const data = await this.s3.putTextObject(taskObjectName, JSON.stringify(task), "l2-proc");

      const taskDbObject = {
        id: taskObjectName,
        bucket: "l2-proc",
        name: taskObjectName,
        etag: data.ETag,
        size: data.Size,
        active: task.deleted,
      }

      await this.storageService.initObject(taskDbObject);

      if (sourceObjectName && sourceObject) {
        // Link task to sources
        await this.lineage.updateObjectLink("l1-raw", sourceObjectName, {
          serviceName: ServiceName.ENOT,
          trackingId: data.ETag,
          references: { objectName: taskObjectName, url: task.url },
        }, LinkType.TARGET);

        // Link source object to task
        await this.lineage.updateObjectLink("l2-proc", taskObjectName, {
          serviceName: ServiceName.STORAGE_VERSION,
          trackingId: sourceObject.etag,
          references: { objectName: sourceObjectName },
        }, LinkType.SOURCE);
      }

      const metadata:any = {};
      metadata.labels = task.labels;
      metadata.attributes = [{name: "frames", value: task.size}, {name: "owner", value: task?.owner?.username},];

    } else {

      await this.storageService.activateObject("l2-proc", taskObjectName, task.deleted);

    }
  }
}
