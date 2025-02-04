import { Controller, Inject, Logger } from '@nestjs/common';
import { TaskMessageDTO } from '../dto/task.message.dto';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { StorageService } from 'src/services/storage.service';
import { StorageConnector } from 'src/connectors/storage.connector';

@Controller()
export class InboundController {

  private readonly logger = new Logger(InboundController.name);

  constructor(
    private readonly storageService: StorageService,
    @Inject('StorageConnector') private readonly s3: StorageConnector,
  ) { }

  @MessagePattern('task')
  async saveUser(@Payload() task: TaskMessageDTO) {
    const taskObjectName = `${task.projectName}/${task.name}`;
    const taskObject = await this.storageService.getObject("l2-proc", taskObjectName);
    if (!taskObject) {
      this.logger.debug("Creating l2-proc/"+taskObjectName);
      const data = await this.s3.putTextObject(taskObjectName, JSON.stringify(task), "l2-proc");

      const taskDbObject = {
        id: taskObjectName,
        bucket: "l2-proc",
        name: taskObjectName,
        etag: data.ETag,
        size: data.Size,
      }

      await this.storageService.initObject(taskDbObject);
    }
  }
}
