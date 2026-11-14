import os
from dotenv import load_dotenv
load_dotenv()
# from sqlalchemy import create_engine,text,Column,String,Integer
# from sqlalchemy.orm import DeclarativeBase, sessionmaker
from fastapi import HTTPException,Path,Depends
from sqlalchemy import create_engine,text,Column,String,Integer
from sqlalchemy.orm import DeclarativeBase, sessionmaker,Session
from fastapi.middleware.cors import CORSMiddleware  

from fastapi import FastAPI
app=FastAPI()
#cors
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True ,
  allow_headers=["*"],
  allow_methods=["*"]
)

DATABASE_URL=os.getenv("DATABASE_URL")

# print(DATABASE_URL)


#engine creation

engine=create_engine(DATABASE_URL)
with engine.connect() as conn:
  version =conn.execute(text("select version()")).scalar()
  print(f"connected to {version.split()[0]}")


SessionLocal = sessionmaker(bind=engine)
# db = SessionLocal()

class Base(DeclarativeBase):
    pass

class StudentDB(Base):
    __tablename__ = "student_records"
    id      = Column(String, primary_key=True)
    name    = Column(String(50), nullable=False)
    age     = Column(Integer, nullable=False)
    course  = Column(String(50), nullable=False)
    marks   = Column(Integer, nullable=False)
    email   = Column(String, unique=True, nullable=False)  


#bind=engine -> every session travels to this road
Base.metadata.create_all(bind=engine)
print("Table ready...")


from pydantic import BaseModel,Field,EmailStr,field_validator,computed_field,ConfigDict
class StudentCreate(BaseModel):
   id:str=Field(...,description="id of the student")
   name:str=Field(...,min_length=2,max_length=50)
   age:int=Field(...,lt=120,gt=0)
   course:str=Field(...,)
   email:EmailStr
   marks:int=Field(...,ge=0,le=100)

   @field_validator("name")
   @classmethod
   def check_name(cls,value):
      if not value.replace(" ","").isalpha():
         raise ValueError("Name must contain only letters and spaces")

      return value.title()


        
   #pydantic schema for output checking . studentresponse studentpage and message
class StudentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    age: int
    course: str
    marks: int
    email: EmailStr

    @computed_field
    @property
    def grade(self) -> str:
        if self.marks >= 90:
            return "A+"
        elif self.marks >= 80:
            return "A"
        elif self.marks >= 70:
            return "B"
        elif self.marks >= 60:
            return "C"
        else:
            return "fail"
   
   
   

class StudentUpdate(BaseModel):         #pydantic model
    name:str|None=Field(None,min_length=2,max_length=50)
    age:int|None=Field(None,gt=0,lt=100)
    course:str|None=Field(None,max_length=50)
    marks:int|None=Field(None,gt=0,lt=100)
    email:EmailStr|None=None

   
#get db opens a session ,gives it to the end point and always closes it , replace load_data /save data 

def get_db():
   db=SessionLocal()
   try:
      yield db
   finally:
      db.close()




#get a studdent
@app.get('/student/{student_id}',response_model=StudentResponse)
def get_student(
   student_id:str=Path(...,description="The student id of the student"),
   db: Session=Depends(get_db)
):
   student=db.get(StudentDB,student_id)
   if student is None:
      raise HTTPException(status_code=404,detail=f"student with the id {student_id} not exist ")

   return student

#post -create a student
from sqlalchemy.exc import IntegrityError
@app.post('/create',status_code=201,response_model=StudentResponse)
def create_st(student:StudentCreate,db:Session=Depends(get_db)):
  

   if db.get(StudentDB,student.id):
        raise HTTPException(
            status_code=409,
            detail="Student already exists"
        )

   new_student=StudentDB(**student.model_dump())
   db.add(new_student)
   try:
      db.commit()
   except IntegrityError:
      raise HTTPException(status_code=409,detail="email already exist.")

   db.refresh(new_student)
   return new_student



#update
@app.put('/update/{student_id}',response_model=StudentResponse)
def update_student(
   student_data:StudentUpdate,
   student_id:str=Path(...,description="id of the student"),
   db: Session = Depends(get_db)
   
):
   student=db.get(StudentDB,student_id)
   if student is None:
      raise HTTPException(
         status_code=409,
         detail=f"student with id {student_id} is not present "
      )

   changes=student_data.model_dump(exclude_unset=True)
   for key,val in changes.items():
      setattr(student,key,val)


   try:
      db.commit()
   except IntegrityError:
      db.rollback()
      raise HTTPException(status_code=409,detail="email already exist.")
   
   db.refresh(student)
   return student


@app.delete('/delete/{st_id}')
def delete_student(st_id:str=Path(...,description="id of the student"),
                   db:Session=Depends(get_db)):
   st=db.get(StudentDB,st_id)
   if st is None:
      raise HTTPException(
         status_code= 404, 
         detail=f"student with this id {st_id} is not present"
      )

   db.delete(st)
   db.commit()
   return{"message":f"student with {st_id} deleted succesfully"}


#sort

SORT_FIELD = ["name", "marks", "age"]
SORT_ORDER = ["asc", "desc"]
from fastapi import Query
@app.get('/sort', response_model=list[StudentResponse])
def sort_student(
    sort_by: str = Query(..., description="Sort by name, marks, age"),
    order: str = Query("asc", description="asc or desc"),
    db: Session = Depends(get_db)
):
    if sort_by not in SORT_FIELD:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort field. Choose from {SORT_FIELD}"
        )

    if order not in SORT_ORDER:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort order. Choose from {SORT_ORDER}"
        )

    column = getattr(StudentDB, sort_by)

    if order == "asc":
        query = db.query(StudentDB).order_by(column.asc())
    else:
        query = db.query(StudentDB).order_by(column.desc())

    return query.all()


#filter

@app.get('/filter', response_model=list[StudentResponse])
def filter_student(
    course: str | None = Query(
        None,
        description="Show only students enrolled in this course"
    ),
    db: Session = Depends(get_db)
):
    query = db.query(StudentDB)

    if course is not None:
        query = query.filter(StudentDB.course == course)

    return query.all()



#pagination

@app.get('/pagination')
def paginate(
    page: int = Query(1, ge=1),
    limit: int = Query(5, ge=1, le=100),
    db: Session = Depends(get_db)
):
    start = (page - 1) * limit

    total_st = db.query(StudentDB).count()

    page_st = (
        db.query(StudentDB)
        .offset(start)
        .limit(limit)
        .all()
    )

    return {
        "page": page,
        "limit": limit,
        "total": total_st,
        "students": page_st
    }
