
export interface Salesperson {
  name: string;
  email: string;
  phone?: string;
}

export interface Branch {
  name: string;
  headName: string;
  headEmail: string;
  headPhone: string;
  salespeople: Salesperson[];
}

export const BRANCH_DATA: Branch[] = [
  {
    name: "Mumbai",
    headName: "Tushar Padavi",
    headEmail: "mis.mumbai@ginzalimited.com",
    headPhone: "8766801003",
    salespeople: [
      { name: "Aditya", email: "tushpadavi1@gmail.com", phone: "8208628208" },
      { name: "Amit Korgaonkar", email: "amit.korgaonkar@ginzalimited.com", phone: "9833181414" },
      { name: "Santosh Pachratkar", email: "santosh.pachratkar@ginzalimited.com", phone: "9320167523" },
      { name: "Rakesh Jain", email: "rakesh.jain@ginzalimited.com", phone: "9370672000" },
      { name: "Kamlesh Sutar", email: "kamlesh.sutar@ginzalimited.com", phone: "9004095847" },
      { name: "Pradeep Jadhav", email: "pradeep.jadhav@ginzalimited.com", phone: "8976230355" },
    ]
  },
  {
    name: "Ulasnagar",
    headName: "Sachin Bhosale",
    headEmail: "sachin.bhosle@ginzalimited.com",
    headPhone: "9323712722",
    salespeople: [
      { name: "Sachin Bhosale", email: "sachin.bhosle@ginzalimited.com", phone: "9323712722" },
      { name: "Shiv Ratan (Shivam)", email: "shivginza123@gmail.com", phone: "7507729637" },
      { name: "Viay Sutar", email: "sutarvijay70@gmail.com", phone: "9270559834" },
    ]
  },
  {
    name: "Kolkata",
    headName: "Vishal Ambhore",
    headEmail: "vishalambhore@ginzalimited.com",
    headPhone: "8805796399",
    salespeople: [
      { name: "Vishal Ambhore", email: "vishalambhore@ginzalimited.com", phone: "8805796399" },
      { name: "Rajesh Jain", email: "rajesh.jain@ginzalimited.com", phone: "9830091088" },
    ]
  },
  {
    name: "Jaipur",
    headName: "Vishal Ambhore",
    headEmail: "vishalambhore@ginzalimited.com",
    headPhone: "8805796399",
    salespeople: [
      { name: "Vishal Ambhore", email: "vishalambhore@ginzalimited.com", phone: "8805796399" },
      { name: "Durgesh Bhati", email: "durgeshbati7740@gmail.com", phone: "9845717740" },
    ]
  },
  {
    name: "Delhi",
    headName: "Vinay Chhajer",
    headEmail: "vinay.chhajer@ginzalimited.com",
    headPhone: "8448699899",
    salespeople: [
      { name: "Vinay Chhajer", email: "vinay.chhajer@ginzalimited.com", phone: "8448699899" },
      { name: "Lalit Maroo", email: "lalit.delhi@ginzalimited.com", phone: "9310322650" },
      { name: "Anish Jain", email: "anish.delhi@ginzalimited.com", phone: "8448699896" },
      { name: "Suresh Nautiyal", email: "mukesh.delhi@ginzalimited.com", phone: "7428159303" },
      { name: "Rahul Vashishtha", email: "sales2.delhi@ginzalimited.com", phone: "9310222650" },
      { name: "Mohit Sharma", email: "sales1.delhi@ginzalimited.com", phone: "9311322650" },
    ]
  },
  {
    name: "Ahmedabad",
    headName: "Ravindra kaushik",
    headEmail: "ahmedabad@ginzalimited.com",
    headPhone: "8779309155",
    salespeople: [
      { name: "ravindra kaushik", email: "ahmedabad@ginzalimited.com", phone: "8779309155" },
    ]
  },
  {
    name: "Bangalore",
    headName: "Murali Krishna",
    headEmail: "murali.krishna@ginzalimited.com",
    headPhone: "9500342401",
    salespeople: [
      { name: "Murali Krishna", email: "murali.krishna@ginzalimited.com", phone: "9500342401" },
      { name: "Balasubramanyam", email: "ginzabala1985@gmail.com", phone: "8553314581" },
      { name: "Tarachand", email: "mjbhati50@gmail.com", phone: "8233508636" },
    ]
  },
  {
    name: "Tirupur",
    headName: "Ravi Varman",
    headEmail: "tirupur@ginzalimited.com",
    headPhone: "9940860753",
    salespeople: [
      { name: "Ravi Varman", email: "tirupur@ginzalimited.com", phone: "9940860753" },
      { name: "Alexander Pushkin", email: "tps@ginzalimited.com", phone: "9944479308" },
      { name: "Subramanian", email: "smanianginza@gmail.com", phone: "9940870153" },
      { name: "Mani Maran", email: "maran236@gmail.com", phone: "9940870553" },
    ]
  },
  {
    name: "Surat",
    headName: "Piyush Baid",
    headEmail: "piyush.baid@ginzalimited.com",
    headPhone: "7742088735",
    salespeople: [
      { name: "Piyush Baid", email: "piyush.baid@ginzalimited.com", phone: "7742088735" },
      { name: "Anil Marthe", email: "anil.udhna@ginzalimted.com", phone: "9377592816" },
      { name: "Raghuveer Darbar", email: "raghuvirdarbar9@gmail.com", phone: "9510780707" },
      { name: "Sailesh Pathak", email: "shailesh.udhna@ginzalimited.com", phone: "9328764337" },
      { name: "Vanraj Darbar", email: "vanraj.sales@ginzalimited.com", phone: "9624080222" },
      { name: "Mahesh Chandeliya", email: "mahesh.chandeliya@ginzalimited.com", phone: "9322976587" },
    ]
  }
];
