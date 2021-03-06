import {HttpException, HttpService, HttpStatus, Inject, Injectable} from '@nestjs/common';
import {google} from 'googleapis';
import {get} from 'lodash';
import {eachLimit} from 'async';
import {DateTime} from 'luxon';
import {CrudService} from '../../base';
import {HomeEntity} from './entity';
import {HOME_TOKEN} from './home.constants';
import {MongoRepository, Repository} from 'typeorm';
import {config} from '../../config';
import {AppLogger} from '../app.logger';
import {AttomDataApiService} from './attom-data-api.service';
import faker from 'faker';
import {UserService} from '../user/user.service';
import {HomeMedia, Property} from '../graphql.schema';
import {HomeMediaService} from '../home-media/home-media.service';
import {renderTemplate} from '../_helpers/mail';
import S3 from 'aws-sdk/clients/s3';
import {ConvertTemplateDto} from './dto/convert-template.dto';

@Injectable()
export class HomeService extends CrudService<HomeEntity> {

	private logger = new AppLogger(HomeService.name);

	constructor(
		@Inject(HOME_TOKEN) protected readonly repository: MongoRepository<HomeEntity>,
		private readonly httpService: HttpService,
		private readonly userService: UserService,
		private readonly homeMediaService: HomeMediaService,
		private readonly attomApi: AttomDataApiService
	) {
		super();
	}

	public async callApi2pdf({home, media}: { home: HomeEntity, media: ConvertTemplateDto }): Promise<any> {
		const template = renderTemplate(`/media/templates/${media.template}`, {home, media});
		const response = await this.httpService.post(`https://v2018.api2pdf.com/chrome/html`, {
			html: template
		}, {
			headers: {
				Authorization: config.api2pdf.apiKey
			}
		}).toPromise();
		const {data} = await this.downloadPdf(response.data.pdf);
		const params = await this.uploadToS3(data);
		return {
			bucket: params.Bucket,
			key: params.Key
		};
	}

	public async importAddresses(): Promise<void> {
		return new Promise(async (resolve, reject) => {

			this.logger.debug(`[importAddresses] delete from home everything with json "faker"`);
			await this.deleteAll({json: {eq: '{"faker": true}'}});
			this.logger.debug(`[importAddresses] delete from home_media everything with mimetype "image/fake"`);
			await this.homeMediaService.deleteAll({mimetype: {eq: 'image/fake'}});

			this.logger.debug(`[importAddresses] Find 20 faked users`);

			const users = await this.userService.findAll({where: {provider: {eq: 'faker'}}, take: 20});
			const usersIds = users.map(user => user.id.toString());

			this.logger.debug(`[importAddresses] Gathering sheet info`);

			const sheets = google.sheets({version: 'v4', auth: config.googleApi.apiKey});
			const res = await sheets.spreadsheets.values.get({
				spreadsheetId: '1HZK3jv-rAteimv0LqVLR1XbX9BUTch-2dgsQfQt1FaI',
				range: 'Addresses!A2:C'
			});

			if (res.status !== 200) {
				throw new HttpException(res, HttpStatus.BAD_REQUEST);
			}

			const rows: any[] = res.data.values;
			if (!rows.length) {
				this.logger.warn(`[importAddresses] Sheet empty`);
				return;
			}

			const homes = [];
			const medias = [];

			eachLimit(rows, 4, (row, cb) => {
				this.getHomeFor(row, usersIds).then(([home, ...homeMedias]) => {
					if (home) {
						homes.push(home);
					}
					if (homeMedias.length) {
						homeMedias.forEach(hm => {
							if (hm) {
								medias.push(hm);
							}
						});
					}
					cb();
				});
			}, () => {
				this.logger.debug(`[importAddresses] create ${rows.length} homes from spreadsheet with json {"faker": true}`);

				this.logger.debug(`[importAddresses] saving home & home medias`);

				Promise.all([
					this.homeMediaService.saveAll(medias)
				]).then(() => {
					this.logger.debug(`[importAddresses] done!`);
					resolve();
				}).catch(err => {
					this.logger.error(err.message, err.stack);
					reject();
				});
			});
		});
	}

	private async downloadPdf(pdfUrl: string) {
		this.logger.debug(`[downloadPdf] Path for pdf is: ${pdfUrl}`);
		return await this.httpService.get(pdfUrl, {responseType: 'arraybuffer'}).toPromise();
	}

	private async uploadToS3(buff: Buffer): Promise<any> {
		const s3 = new S3();
		const bucket = config.aws.s3.bucket_name;
		const params = {
			Bucket: bucket,
			Key: faker.random.uuid(),
			ACL: 'public-read',
			ContentType: 'application/pdf',
			Body: buff
		};
		await s3.putObject(params).promise();
		this.logger.debug(`[uploadToS3] Path for uploaded pdf at s3 is: https://s3.us-east-2.amazonaws.com/${bucket}/${params.Key}`);
		return params;
	}

	private async getHomeFor(row: any, usersIds): Promise<[HomeEntity, ...HomeMedia[]]> {
		const [address1, ...endAddress] = row[1].split(',');
		const address2 = endAddress.map(a => a.trim()).join(', ');

		try {
			const res = await this.attomApi.getAVMDetail({
				address1,
				address2
			});

			if (!res.data.property.length) {
				return [null, null];
			}

			const property: Property = res.data.property.pop();
			const home: any = {
				owner: faker.random.arrayElement(usersIds),
				json: '{"faker": true}',
				price: Number(faker.finance.amount(100000, 1000000)),
				price_adjustment: faker.random.number(100),
				descr: faker.lorem.paragraphs(faker.random.number({max: 5, min: 1})),
				address_1: address1,
				address_2: address2,
				city: get(property, 'address.locality', faker.address.city()),
				state: get(property, 'address.countrySubd', faker.address.state()),
				zip: get(property, 'address.postal1', faker.address.zipCode()),
				country: get(property, 'address.country', 'US'),
				beds: Number(get(property, 'building.rooms.beds', faker.random.number({max: 10, min: 1}))),
				baths: get(property, 'building.rooms.bathstotal', faker.random.number({max: 10, min: 1})),
				lot_size: get(property, 'lot.lotsize2', faker.random.number(20)),
				sqft: get(property, 'building.size.bldgsize', faker.random.number({max: 1350, min: 50})),
				lat: Number(get(property, 'location.latitude', faker.address.latitude())),
				lng: Number(get(property, 'location.longitude', faker.address.longitude())),
				pool: faker.random.boolean(),
				fav_count: faker.random.number(10),
				showing_count: faker.random.number({max: 100000, min: 100}),
				buyers_agent: faker.random.boolean(),
				isDeleted: false,
				nonrealty_items: faker.random.words(),
				lot: faker.random.word(),
				block: faker.random.word(),
				addition: faker.random.word(),
				mortgage_amount: faker.random.number(),
				mortgage_date: faker.date.past(),
				electricity: faker.random.number(),
				gas: faker.random.number(),
				internet: faker.random.number(),
				cable_sattelite: faker.random.number(),
				homeowners_insurance: faker.random.number(),
				agent: faker.random.word(),
				agent_fee: faker.random.number(),
				survey_date: faker.date.future(),
				hoa: faker.random.number(),
				elementary_school: faker.random.words(3),
				middle_school: faker.random.words(3),
				high_school: faker.random.words(3),
				style: faker.random.words(2),
				type: faker.random.words(2),
				roof_type: faker.random.words(2),
				exterior_material: faker.random.words(2),
				foundation_type: faker.random.words(2),
				utilities: faker.random.words(5),
				parking: faker.random.words(2),
				patio: faker.random.words(6),
				yard: faker.random.words(6),
				sprinklers: faker.random.words(3),
				lot_depth: faker.random.number(),
				lot_width: faker.random.word(),
				parcel_number: faker.random.word(),
				tax_history: faker.random.word(),
				createdAt: DateTime.utc().toString(),
				updatedAt: DateTime.utc().toString()
			};

			const savedHomes = await this.saveAll([home]);

			const medias = [];

			for (let i = 2; i < 6; ++i) {
				if (!row[i]) {
					continue;
				}

				medias.push({
					homeId: savedHomes[0].id.toString(),
					originalname: faker.system.commonFileName('jpeg'),
					mimetype: 'image/fake',
					size: faker.random.number({min: 86400, max: 259200}),
					url: row[i],
					type: faker.hacker.noun(),
					order: i,
					caption: faker.random.word(),
					isDeleted: false,
					createdAt: DateTime.utc().toString(),
					updatedAt: DateTime.utc().toString()
				});
			}

			return [home, ...medias];
		} catch (e) {
			this.logger.debug(`address1, address2: ${address1}, ${address2}`);
			this.logger.error(e.message, e.stack);
			return [null, null];
		}
	}
}
