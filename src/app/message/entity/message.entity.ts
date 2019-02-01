import {attribute, autoGeneratedHashKey, table} from '@aws/dynamodb-data-mapper-annotations';
import {ApiModelProperty} from '@nestjs/swagger';
import {ExtendedEntity} from '../../_helpers';
import {IsBoolean, IsString} from 'class-validator';

@table(`message`)
export class MessageEntity extends ExtendedEntity {

	@ApiModelProperty()
	@autoGeneratedHashKey()
	public id: string;

	@ApiModelProperty()
	@IsString()
	@attribute()
	public authorId: string;

	@ApiModelProperty()
	@IsString()
	@attribute()
	public content: string;

	@ApiModelProperty()
	@IsString()
	@attribute()
	public conversationId: string;

	@ApiModelProperty()
	@IsString()
	@attribute()
	public createdAt: string;

	@ApiModelProperty()
	@IsBoolean()
	@attribute()
	public isSent: boolean;

	@ApiModelProperty()
	@IsBoolean()
	@attribute()
	public isRead: boolean;
}
