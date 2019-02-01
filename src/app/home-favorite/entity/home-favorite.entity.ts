import {attribute, autoGeneratedHashKey, table} from '@aws/dynamodb-data-mapper-annotations';
import {ApiModelProperty} from '@nestjs/swagger';
import {ExtendedEntity} from '../../_helpers';
import {IsString} from 'class-validator';

@table(`home_favorite`)
export class HomeFavoriteEntity extends ExtendedEntity {

	@ApiModelProperty()
	@autoGeneratedHashKey()
	public id: string;


	@ApiModelProperty()
	@IsString()
	@attribute()
	public homeFavoriteUserId: string;

	@ApiModelProperty()
	@IsString()
	@attribute()
	public homeFavoriteHomeId: string;
}
