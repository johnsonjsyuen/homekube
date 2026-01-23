use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "speedtest_results")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub timestamp: DateTimeWithTimeZone,
    pub server_id: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub server_name: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub server_country: Option<String>,
    pub latency_ms: Option<f32>,
    pub download_bandwidth: Option<i32>,
    pub upload_bandwidth: Option<i32>,
    pub download_bytes: Option<i32>,
    pub upload_bytes: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub result_url: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
