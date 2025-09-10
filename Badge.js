import React from 'react';
import { View, Text, StyleSheet,Image } from 'react-native';

const StatCard = ({ title, value,icon,sub }) => {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.valueContainer}>
      <Text style={styles.cardValue}>{value.toLocaleString()}</Text>
        {icon && <Image source={icon} style={styles.icon} />}
    </View>
    <Text style={styles.sub}>{sub}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  sub:{
      fontSize:10,
      textAlign: "center"
      
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    
    width: 20,  // Set appropriate width and height
    height: 20,
    marginBottom:10
  },
  card: {
    backgroundColor: '#ffffff', // White background for the card
    borderRadius: 8,
    padding: 15,
    alignItems:"center",
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    shadowOpacity: 0.1,
    elevation: 2, // for Android shadow
    flex:1,
    marginLeft: 10,
    marginRight: 10,
    
    height:100,
  },
  cardTitle: {
    color: 'black', // Bootstrap primary color
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  cardValue: {
    
    fontSize: 16,
    color: 'black', // Bootstrap dark color
    marginBottom:5,
  }
});

export default StatCard;
